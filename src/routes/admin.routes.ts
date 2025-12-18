import { Router } from "express";
import { prisma } from "../lib/prisma";

const router = Router();

router.get("/analytics", async (_req, res) => {
  const [activeCount, closedCount] = await Promise.all([
    prisma.chatSession.count({ where: { status: "ACTIVE" } }),
    prisma.chatSession.count({ where: { status: "CLOSED" } }),
  ]);

  res.json({
    activeCount,
    closedCount,
    totalCount: activeCount + closedCount,
  });
});

router.get("/chats", async (req, res) => {
  const statusFilter = req.query.status as string | undefined;
  const chats = await prisma.chatSession.findMany({
    where: statusFilter ? { status: statusFilter as any } : undefined,
    orderBy: { updatedAt: "desc" },
    include: { user: true },
  });

  res.json(chats);
});

router.get("/chats/:id/messages", async (req, res) => {
  const messages = await prisma.message.findMany({
    where: { chatId: req.params.id },
    orderBy: { createdAt: "asc" },
  });
  res.json(messages);
});

router.post("/chats/:id/close", async (req, res) => {
  await prisma.chatSession.update({
    where: { id: req.params.id },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  res.json({ ok: true });
});

router.post("/chats/:id/reopen", async (req, res) => {
  await prisma.chatSession.update({
    where: { id: req.params.id },
    data: { status: "ACTIVE", closedAt: null },
  });
  res.json({ ok: true });
});

export default router;
