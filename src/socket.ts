import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { prisma } from "./lib/prisma"; // Prisma client instance

interface SendMessagePayload {
  chatId?: string;
  content: string;
  sender: "USER" | "ADMIN";
}

export const initSocket = (server: HttpServer) => {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    // join chat room
    socket.on("join-chat", (chatId: string) => {
      socket.join(chatId);
    });

    // send message
    socket.on("send-message", async (payload: SendMessagePayload) => {
      let chatId = payload.chatId;

      if (chatId) {
        const existing = await prisma.chatSession.findUnique({
          where: { id: chatId },
          select: { status: true },
        });

        if (!existing) {
          socket.emit("chat-error", { message: "Chat not found" });
          return;
        }

        if (existing.status === "CLOSED") {
          socket.emit("chat-closed", { chatId, reason: "Chat has been closed" });
          return;
        }
      }

      // create new chat if not exists
      if (!chatId) {
        const chat = await prisma.chatSession.create({
          data: { status: "ACTIVE" },
        });
        chatId = chat.id;
      }

      // save message
      const message = await prisma.message.create({
        data: {
          content: payload.content,
          sender: payload.sender,
          chatId,
        },
      });

      // bump chat metadata for ordering and previews
      await prisma.chatSession.update({
        where: { id: chatId },
        data: {
          lastMessage: payload.content,
          status: "ACTIVE",
          closedAt: null,
        },
      });

      // emit message to room
      io.to(chatId).emit("receive-message", {
        chatId,
        message,
      });
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });
};
