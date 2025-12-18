import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { prisma } from "./lib/prisma"; // Assume prismaClient is set up properly

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

      // create new chat if not exists
      if (!chatId) {
        const chat = await prisma.chatSession.create({
          data: {},
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
