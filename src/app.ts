import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import adminRoutes from "./routes/admin.routes";
import authRoutes from "./routes/auth.routes";
import { prisma } from "./lib/prisma";

const app = express();

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3001",
  process.env.FRONTEND_URL,
].filter(Boolean);

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(null, true);
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);
app.use(express.json());
app.use(cookieParser());

// client chat routes
app.post("/chat/start", async (req: Request, res: Response) => {
    try {
        const { name } = req.body as { name?: string };
        let userId: string;

        if (name) {
            const email = `guest_${Date.now()}@chatbot.local`;
            const password = Math.random().toString(36).slice(-12);
            const user = await prisma.user.create({ 
                data: { name, email, password } 
            });
            userId = user.id;
        } else {
            const email = `guest_${Date.now()}@chatbot.local`;
            const password = Math.random().toString(36).slice(-12);
            const user = await prisma.user.create({ 
                data: { name: "Guest User", email, password } 
            });
            userId = user.id;
        }

        const chat = await prisma.chatSession.create({
            data: { userId },
        });

        res.cookie("chat_session_id", chat.id, {
            httpOnly: false,
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 30,
        });

        res.json({ chat });
    } catch (error) {
        console.error("/chat/start error", error);
        res.status(500).json({ error: "Unable to start chat" });
    }
});

app.get("/chat/:id", async (req: Request, res: Response) => {
    try {
        const chat = await prisma.chatSession.findUnique({
            where: { id: req.params.id },
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
        });

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        const messages = await prisma.message.findMany({
            where: { chatId: chat.id },
            orderBy: { createdAt: "asc" },
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
        });

        const formattedMessages = messages.map((msg) => ({
            id: msg.id,
            content: msg.content,
            isBot: msg.isBot,
            createdAt: msg.createdAt,
            sender: msg.isBot ? "ADMIN" : "USER",
            userId: msg.userId,
            user: msg.user,
        }));

        res.json({ chat, messages: formattedMessages });
    } catch (error) {
        console.error("/chat/:id error", error);
        res.status(500).json({ error: "Unable to fetch chat" });
    }
});

app.post("/chat/:id/name", async (req: Request, res: Response) => {
    try {
        const { name } = req.body as { name?: string };
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: "Name is required" });
        }

        const chat = await prisma.chatSession.findUnique({
            where: { id: req.params.id },
            select: { userId: true },
        });

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        await prisma.user.update({ 
            where: { id: chat.userId }, 
            data: { name: name.trim() } 
        });

        res.json({ ok: true, userId: chat.userId });
    } catch (error) {
        console.error("/chat/:id/name error", error);
        res.status(500).json({ error: "Unable to save name" });
    }
});

app.post("/chat/:id/close", async (req: Request, res: Response) => {
    try {
        const chat = await prisma.chatSession.findUnique({
            where: { id: req.params.id },
        });

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        await prisma.chatSession.update({
            where: { id: req.params.id },
            data: { status: "CLOSED", closedAt: new Date() },
        });

        res.json({ ok: true });
    } catch (error) {
        console.error("/chat/:id/close error", error);
        res.status(500).json({ error: "Unable to close chat" });
    }
});

app.use("/auth", authRoutes);
app.use("/admin", adminRoutes);

app.get("/", (_req: Request, res: Response) => {
    res.send("API is running...");
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("Unhandled error:", err);
    res.status(500).json({ error: "Internal server error" });
});

export default app;

