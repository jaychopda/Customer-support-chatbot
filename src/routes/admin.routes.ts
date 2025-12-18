import { Router, Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

// ============ MIDDLEWARE - Error Handler ============
const asyncHandler = (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };

// ============ ENHANCED ANALYTICS ============
router.get(
  "/analytics",
  asyncHandler(async (_req: Request, res: Response) => {
    const [activeCount, closedCount, totalUsers, avgResolutionTime, totalMessages] =
      await Promise.all([
        prisma.chatSession.count({ where: { status: "ACTIVE" } }),
        prisma.chatSession.count({ where: { status: "CLOSED" } }),
        prisma.user.count(),
        prisma.chatSession.aggregate({
          where: { status: "CLOSED", closedAt: { not: null } },
          _avg: { duration: true },
        }),
        prisma.message.count(),
      ]);

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const [monthlyChats, weeklyChats] = await Promise.all([
      prisma.chatSession.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.chatSession.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
    ]);

    const totalChats = activeCount + closedCount;
    const resolutionRate =
      totalChats > 0 ? ((closedCount / totalChats) * 100).toFixed(2) : "0";

    res.json({
      overview: {
        activeCount,
        closedCount,
        totalCount: totalChats,
        totalUsers,
        totalMessages,
      },
      metrics: {
        avgResolutionTime: avgResolutionTime._avg.duration || 0,
        resolutionRate: parseFloat(resolutionRate as string),
        avgMessagesPerChat: (totalMessages / (totalChats || 1)).toFixed(2),
        chatsPerUser: (totalChats / (totalUsers || 1)).toFixed(2),
      },
      trends: {
        monthlyChats,
        weeklyChats,
        monthlyGrowth:
          monthlyChats > 0
            ? ((weeklyChats / monthlyChats) * 100).toFixed(2)
            : "0",
      },
      timestamp: new Date(),
    });
  })
);

// ============ ADVANCED ANALYTICS BY DATE RANGE ============
router.get(
  "/analytics/timeline",
  asyncHandler(async (req: Request, res: Response) => {
    const { startDate, endDate, groupBy = "day" } = req.query;

    if (!startDate || !endDate) {
      return res.status(400).json({ error: "startDate and endDate are required" });
    }

    const start = new Date(startDate as string);
    const end = new Date(endDate as string);

    const chats = await prisma.chatSession.findMany({
      where: {
        createdAt: { gte: start, lte: end },
      },
      select: {
        createdAt: true,
        status: true,
        duration: true,
      },
    });

    const groupedData =
      groupBy === "day" ? groupByDay(chats) : groupByHour(chats);

    res.json({ data: groupedData, range: { start, end } });
  })
);

// ============ ADVANCED SEARCH ============
router.get(
  "/search",
  asyncHandler(async (req: Request, res: Response) => {
    const { query, type, limit = "10" } = req.query as {
      query: string;
      type?: string;
      limit?: string;
    };

    if (!query || query.length < 2) {
      return res
        .status(400)
        .json({ error: "Search query must be at least 2 characters" });
    }

    const searchLimit = Math.min(parseInt(limit), 50);
    const searchQuery = { contains: query, mode: "insensitive" as const };
    const results: Record<string, unknown> = {};

    if (!type || type === "chats") {
      results.chats = await prisma.chatSession.findMany({
        where: {
          OR: [
            { id: searchQuery },
            { user: { email: searchQuery } },
            { user: { name: searchQuery } },
          ],
        },
        include: { user: true, _count: { select: { messages: true } } },
        take: searchLimit,
      });
    }

    if (!type || type === "messages") {
      results.messages = await prisma.message.findMany({
        where: { content: searchQuery },
        include: { chat: { include: { user: true } } },
        take: searchLimit,
      });
    }

    if (!type || type === "users") {
      results.users = await prisma.user.findMany({
        where: { OR: [{ name: searchQuery }, { email: searchQuery }] },
        take: searchLimit,
      });
    }

    if (!type || type === "feedback") {
      results.feedback = await prisma.chatSession.findMany({
        where: { 
          OR: [
            { feedback: { comment: searchQuery } },
          ],
          status: "CLOSED" 
        },
        include: { user: true },
        take: searchLimit,
      });
    }

    res.json(results);
  })
);

// ============ ACTIVE CHATS (ARRAY FORMAT) ============
router.get(
  "/chats/active",
  asyncHandler(async (req: Request, res: Response) => {
    const chats = await prisma.chatSession.findMany({
      where: { status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        _count: { select: { messages: true } },
      },
    });

    const formattedChats = chats.map((chat) => ({
      ...chat,
      lastMessage: chat.messages[0]?.content || null,
    }));

    res.json(formattedChats);
  })
);

// ============ ENHANCED CHATS WITH FILTERS ============
router.get(
  "/chats",
  asyncHandler(async (req: Request, res: Response) => {
    const { status, search, sortBy = "updatedAt", page = "1", startDate, endDate, array } =
      req.query;
    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const pageSize = 20;

    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (search) {
      where.OR = [
        { id: { contains: search as string, mode: "insensitive" } },
        { user: { email: { contains: search as string, mode: "insensitive" } } },
        { user: { name: { contains: search as string, mode: "insensitive" } } },
      ];
    }
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) (where.createdAt as Record<string, Date>).gte = new Date(startDate as string);
      if (endDate) (where.createdAt as Record<string, Date>).lte = new Date(endDate as string);
    }

    const chats = await prisma.chatSession.findMany({
      where,
      orderBy: { [sortBy as string]: "desc" },
      include: {
        user: {
          select: {
            id: true,
            name: true,
            email: true,
            role: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { createdAt: "desc" },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                role: true,
              },
            },
          },
        },
        _count: { select: { messages: true } },
      },
      skip: array === "true" ? 0 : (pageNum - 1) * pageSize,
      take: array === "true" ? 1000 : pageSize,
    });

    if (array === "true") {
      return res.json(chats);
    }

    const total = await prisma.chatSession.count({ where });

    res.json({
      data: chats,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  })
);

// ============ CHAT MESSAGES WITH SEARCH ============
router.get(
  "/chats/:id/messages",
  asyncHandler(async (req: Request, res: Response) => {
    const { search, page = "1" } = req.query;
    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const pageSize = 50;

    const chat = await prisma.chatSession.findUnique({
      where: { id: req.params.id },
    });

    if (!chat) {
      return res.status(404).json({ error: "Chat not found" });
    }

    const where: Record<string, unknown> = { chatId: req.params.id };
    if (search) {
      where.content = { contains: search as string, mode: "insensitive" };
    }

    const [messages, total] = await Promise.all([
      prisma.message.findMany({
        where,
        orderBy: { createdAt: "asc" },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true,
            },
          },
        },
      }),
      prisma.message.count({ where }),
    ]);

    const formattedMessages = messages.map((msg) => ({
      id: msg.id,
      content: msg.content,
      isBot: msg.isBot,
      createdAt: msg.createdAt,
      sender: msg.isBot ? "ADMIN" : "USER",
      userId: msg.userId,
      user: msg.user,
    }));

    res.json({
      data: formattedMessages,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  })
);

// ============ CLOSE CHAT ============
router.post(
  "/chats/:id/close",
  asyncHandler(async (req: Request, res: Response) => {
    const { reason, notes } = req.body as {
      reason: string;
      notes?: string;
    };

    if (!reason) {
      return res.status(400).json({ error: "Reason is required" });
    }

    const chat = await prisma.chatSession.update({
      where: { id: req.params.id },
      data: {
        status: "CLOSED",
        closedAt: new Date(),
        closureReason: reason,
        notes,
      },
      include: {
        user: true,
      },
    });

    const io = (global as any).io;
    if (io) {
      io.to(req.params.id).emit("chat-closed-by-admin", {
        chatId: req.params.id,
        reason: reason,
        message: "This chat has been closed by an administrator",
      });
    }

    res.json({ ok: true, message: "Chat closed successfully" });
  })
);

// ============ REOPEN CHAT ============
router.post(
  "/chats/:id/reopen",
  asyncHandler(async (req: Request, res: Response) => {
    const { reason } = req.body as { reason?: string };

    await prisma.chatSession.update({
      where: { id: req.params.id },
      data: { status: "ACTIVE", closedAt: null, notes: reason },
    });

    res.json({ ok: true, message: "Chat reopened successfully" });
  })
);

// ============ ASSIGN CHAT TO AGENT ============
router.post(
  "/chats/:id/assign",
  asyncHandler(async (req: Request, res: Response) => {
    const { agentId } = req.body as { agentId: string };

    if (!agentId) {
      return res.status(400).json({ error: "Agent ID is required" });
    }

    const agent = await prisma.user.findUnique({ where: { id: agentId } });
    if (!agent || agent.role !== "AGENT") {
      return res.status(400).json({ error: "Invalid agent" });
    }

    await prisma.chatSession.update({
      where: { id: req.params.id },
      data: { assignedAgentId: agentId },
    });

    res.json({ ok: true, message: "Chat assigned successfully" });
  })
);

// ============ ADD INTERNAL NOTES TO CHAT ============
router.post(
  "/chats/:id/notes",
  asyncHandler(async (req: Request, res: Response) => {
    const { notes } = req.body as { notes: string };

    if (!notes) {
      return res.status(400).json({ error: "Notes are required" });
    }

    await prisma.chatSession.update({
      where: { id: req.params.id },
      data: { internalNotes: notes },
    });

    res.json({ ok: true, message: "Notes added successfully" });
  })
);

// ============ USER MANAGEMENT ============
router.get(
  "/users",
  asyncHandler(async (req: Request, res: Response) => {
    const { search, role, status, page = "1", sortBy = "createdAt" } =
      req.query;
    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const pageSize = 20;

    const where: Record<string, unknown> = {};
    if (search) {
      where.OR = [
        { name: { contains: search as string, mode: "insensitive" } },
        { email: { contains: search as string, mode: "insensitive" } },
      ];
    }
    if (role) where.role = role;
    if (status === "banned") where.isBanned = true;
    if (status === "active") where.isBanned = false;

    const users = await prisma.user.findMany({
      where,
      skip: (pageNum - 1) * pageSize,
      take: pageSize,
      orderBy: { [sortBy as string]: "desc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        isBanned: true,
        createdAt: true,
        _count: { select: { chats: true } },
      },
    });

    const total = await prisma.user.count({ where });

    res.json({
      data: users,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  })
);

router.get(
  "/users/ensure-admin",
  asyncHandler(async (_req: Request, res: Response) => {
    let admin = await prisma.user.findFirst({
      where: { role: "ADMIN" },
    });

    if (!admin) {
      const bcrypt = require("bcrypt");
      admin = await prisma.user.create({
        data: {
          email: "admin@chatbot.com",
          name: "Admin User",
          password: await bcrypt.hash("admin123", 10),
          role: "ADMIN",
        },
      });
    }

    res.json({
      admin: {
        id: admin.id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
      },
    });
  })
);

// Get single user details
router.get(
  "/users/:id",
  asyncHandler(async (req: Request, res: Response) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.id },
      include: {
        chats: { orderBy: { createdAt: "desc" }, take: 10 },
        _count: { select: { chats: true, messages: true } },
      },
    });

    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json(user);
  })
);

// Update user role
router.patch(
  "/users/:id/role",
  asyncHandler(async (req: Request, res: Response) => {
    const { role } = req.body as { role: string };

    if (!["USER", "ADMIN", "AGENT"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { role },
    });

    res.json({ ok: true, message: "User role updated" });
  })
);

// Ban/Unban user
router.patch(
  "/users/:id/status",
  asyncHandler(async (req: Request, res: Response) => {
    const { isBanned } = req.body as { isBanned: boolean };

    if (typeof isBanned !== "boolean") {
      return res.status(400).json({ error: "isBanned must be a boolean" });
    }

    await prisma.user.update({
      where: { id: req.params.id },
      data: { isBanned },
    });

    res.json({
      ok: true,
      message: `User ${isBanned ? "banned" : "unbanned"}`,
    });
  })
);


// Delete user
router.delete(
  "/users/:id",
  asyncHandler(async (req: Request, res: Response) => {
    await prisma.user.delete({
      where: { id: req.params.id },
    });

    res.json({ ok: true, message: "User deleted successfully" });
  })
);

// ============ SETTINGS MANAGEMENT ============
router.get(
  "/settings",
  asyncHandler(async (_req: Request, res: Response) => {
    let settings = await prisma.adminSettings.findFirst();

    if (!settings) {
      settings = await prisma.adminSettings.create({
        data: {
          id: "default",
          maxChatsPerUser: 5,
          autoCloseTimeout: 3600,
          enableNotifications: true,
          maintenanceMode: false,
          maxMessageLength: 5000,
          enableAutoResponse: true,
        },
      });
    }

    res.json(settings);
  })
);

router.patch(
  "/settings",
  asyncHandler(async (req: Request, res: Response) => {
    const {
      maxChatsPerUser,
      autoCloseTimeout,
      enableNotifications,
      maintenanceMode,
      maxMessageLength,
      enableAutoResponse,
      autoResponseMessage,
    } = req.body as {
      maxChatsPerUser?: number;
      autoCloseTimeout?: number;
      enableNotifications?: boolean;
      maintenanceMode?: boolean;
      maxMessageLength?: number;
      enableAutoResponse?: boolean;
      autoResponseMessage?: string;
    };

    const settings = await prisma.adminSettings.upsert({
      where: { id: "default" },
      update: {
        maxChatsPerUser,
        autoCloseTimeout,
        enableNotifications,
        maintenanceMode,
        maxMessageLength,
        enableAutoResponse,
        autoResponseMessage,
      },
      create: {
        id: "default",
        maxChatsPerUser: maxChatsPerUser || 5,
        autoCloseTimeout: autoCloseTimeout || 3600,
        enableNotifications: enableNotifications !== false,
        maintenanceMode: maintenanceMode || false,
        maxMessageLength: maxMessageLength || 5000,
        enableAutoResponse: enableAutoResponse !== false,
        autoResponseMessage,
      },
    });

    res.json({ ok: true, settings });
  })
);

// ============ ACTIVITY LOGS ============
router.get(
  "/activity-logs",
  asyncHandler(async (req: Request, res: Response) => {
    const { action, userId, page = "1", startDate, endDate } = req.query;
    const pageNum = Math.max(parseInt(page as string) || 1, 1);
    const pageSize = 50;

    const where: Record<string, unknown> = {};
    if (action) where.action = action;
    if (userId) where.userId = userId;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate)
        (where.createdAt as Record<string, Date>).gte = new Date(startDate as string);
      if (endDate)
        (where.createdAt as Record<string, Date>).lte = new Date(endDate as string);
    }

    const [logs, total] = await Promise.all([
      prisma.activityLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (pageNum - 1) * pageSize,
        take: pageSize,
      }),
      prisma.activityLog.count({ where }),
    ]);

    res.json({
      data: logs,
      pagination: {
        page: pageNum,
        pageSize,
        total,
        pages: Math.ceil(total / pageSize),
      },
    });
  })
);

// ============ REPORTS & STATISTICS ============
router.get(
  "/reports/daily",
  asyncHandler(async (req: Request, res: Response) => {
    const { days = "30" } = req.query;
    const dayCount = Math.min(parseInt(days as string) || 30, 365);

    const reports = await prisma.chatSession.groupBy({
      by: ["createdAt"],
      where: {
        createdAt: {
          gte: new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000),
        },
      },
      _count: true,
      _avg: { duration: true },
    });

    res.json(reports);
  })
);

router.get(
  "/reports/satisfaction",
  asyncHandler(async (_req: Request, res: Response) => {
    const satisfaction = await prisma.chatSession.groupBy({
      by: ["satisfactionRating"],
      _count: true,
      where: { status: "CLOSED", satisfactionRating: { not: null } },
    });

    const total = satisfaction.reduce((sum, s) => sum + s._count, 0);

    res.json({
      data: satisfaction,
      total,
      avgRating:
        satisfaction.length > 0
          ? (
              satisfaction.reduce(
                (sum, s) => sum + (s.satisfactionRating || 0) * s._count,
                0
              ) / total
            ).toFixed(2)
          : 0,
    });
  })
);

router.get(
  "/reports/agents",
  asyncHandler(async (req: Request, res: Response) => {
    const agentStats = await prisma.chatSession.groupBy({
      by: ["assignedAgentId"],
      _count: true,
      _avg: { duration: true },
      where: { assignedAgentId: { not: null } },
    });

    res.json(agentStats);
  })
);

// ============ EXPORT DATA ============
router.get(
  "/export/chats",
  asyncHandler(async (req: Request, res: Response) => {
    const { format = "json", status } = req.query;

    const where = status ? { status } : {};

    const chats = await prisma.chatSession.findMany({
      include: { user: true, messages: true },
    });

    if (format === "csv") {
      const csv = convertToCSV(chats);
      res.header("Content-Type", "text/csv");
      res.header(
        "Content-Disposition",
        "attachment; filename=chats.csv"
      );
      return res.send(csv);
    }

    res.json({
      format: "json",
      data: chats,
      exportedAt: new Date(),
      count: chats.length,
    });
  })
);

// Export users
router.get(
  "/export/users",
  asyncHandler(async (req: Request, res: Response) => {
    const users = await prisma.user.findMany({
      include: { _count: { select: { chats: true } } },
    });

    res.json({
      format: "json",
      data: users,
      exportedAt: new Date(),
      count: users.length,
    });
  })
);

// ============ DASHBOARD STATS ============
router.get(
  "/dashboard",
  asyncHandler(async (_req: Request, res: Response) => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      todayChats,
      thisWeekChats,
      thisMonthChats,
      pendingChats,
      totalAgents,
    ] = await Promise.all([
      prisma.chatSession.count({ where: { createdAt: { gte: today } } }),
      prisma.chatSession.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.chatSession.count({
        where: {
          createdAt: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.chatSession.count({ where: { status: "ACTIVE" } }),
      prisma.user.count({ where: { role: "AGENT" } }),
    ]);

    res.json({
      stats: {
        todayChats,
        thisWeekChats,
        thisMonthChats,
        pendingChats,
        totalAgents,
      },
      timestamp: new Date(),
    });
  })
);

// ============ HELPER FUNCTIONS ============
function groupByDay(chats: Array<{ createdAt: Date; status: string; duration: number | null }>) {
  const grouped: Record<string, number> = {};
  chats.forEach((chat) => {
    const date = new Date(chat.createdAt).toISOString().split("T")[0];
    grouped[date] = (grouped[date] || 0) + 1;
  });
  return grouped;
}

function groupByHour(chats: Array<{ createdAt: Date; status: string; duration: number | null }>) {
  const grouped: Record<string, number> = {};
  chats.forEach((chat) => {
    const hour = new Date(chat.createdAt).toISOString().split(":")[0];
    grouped[hour] = (grouped[hour] || 0) + 1;
  });
  return grouped;
}

function convertToCSV(data: unknown[]): string {
  if (data.length === 0) return "";
  const headers = Object.keys(data[0] as Record<string, unknown>);
  const csv = [
    headers.join(","),
    ...data.map((row) =>
      headers
        .map((h) => JSON.stringify((row as Record<string, unknown>)[h]))
        .join(",")
    ),
  ].join("\n");
  return csv;
}

export default router;
