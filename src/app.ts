import express, { Request, Response } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import adminRoutes from "./routes/admin.routes";
import { prisma } from "./lib/prisma";

const app = express();

app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());

// client chat routes
app.post("/chat/start", async (req: Request, res: Response) => {
    try {
        const { name } = req.body as { name?: string };
        let userId: string | undefined;

        if (name) {
            const user = await prisma.user.create({ data: { name, email: "", password: "" } });
            userId = user.id;
        }

        const chat = await prisma.chatSession.create({
            data: userId ? { user: { connect: { id: userId } } } : {},
        });

        res.cookie("chat_session_id", chat.id, {
            httpOnly: false,
            sameSite: "lax",
            maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
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
        });

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        const messages = await prisma.message.findMany({
            where: { chatId: chat.id },
            orderBy: { createdAt: "asc" },
        });

        res.json({ chat, messages });
    } catch (error) {
        console.error("/chat/:id error", error);
        res.status(500).json({ error: "Unable to fetch chat" });
    }
});

app.post("/chat/:id/name", async (req: Request, res: Response) => {
    try {
        const { name } = req.body as { name?: string };
        if (!name) {
            return res.status(400).json({ error: "Name is required" });
        }

        const chat = await prisma.chatSession.findUnique({
            where: { id: req.params.id },
            select: { userId: true },
        });

        if (!chat) {
            return res.status(404).json({ error: "Chat not found" });
        }

        let userId = chat.userId;

        if (userId) {
            await prisma.user.update({ where: { id: userId }, data: { name } });
        } else {
            const user = await prisma.user.create({ data: { name } });
            userId = user.id;
            await prisma.chatSession.update({ where: { id: req.params.id }, data: { userId } });
        }

        res.json({ ok: true, userId });
    } catch (error) {
        console.error("/chat/:id/name error", error);
        res.status(500).json({ error: "Unable to save name" });
    }
});

app.post("/chat/:id/close", async (req: Request, res: Response) => {
    try {
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

app.use("/admin", adminRoutes);

app.get("/", (_req: Request, res: Response) => {
    res.send("API is running...");
});

export default app;

