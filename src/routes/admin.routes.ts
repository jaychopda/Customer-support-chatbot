import { Router } from "express";
import {prisma} from "../lib/prisma";

const router = Router();

router.get("/chats", async (_req, res) => {
  const chats = await prisma.chatSession.findMany({
    orderBy: { createdAt: "desc" },
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

export default router;
