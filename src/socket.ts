import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import { prisma } from "./lib/prisma";

interface SendMessagePayload {
  chatId?: string;
  content: string;
  userId?: string;
  isBot?: boolean;
  sender?: "USER" | "ADMIN";
}

export const initSocket = (server: HttpServer) => {
  const io = new Server(server, {
    cors: { origin: "*" },
  });

  (global as any).io = io;

  io.on("connection", (socket) => {
    console.log("Socket connected:", socket.id);

    socket.on("join-chat", (chatId: string) => {
      socket.join(chatId);
    });

    socket.on("send-message", async (payload: SendMessagePayload) => {
      try {
        console.log("Received send-message:", { 
          chatId: payload.chatId, 
          sender: payload.sender, 
          isBot: payload.isBot,
          hasUserId: !!payload.userId,
          contentLength: payload.content?.length 
        });

        let chatId = payload.chatId;
        let userId = payload.userId;
        const isAdmin = payload.sender === "ADMIN" || payload.isBot === true;

        if (!chatId) {
          socket.emit("chat-error", { message: "Chat ID is required" });
          return;
        }

        const existing = await prisma.chatSession.findUnique({
          where: { id: chatId },
          select: { status: true, userId: true },
        });

        if (!existing) {
          console.error("Chat not found:", chatId);
          socket.emit("chat-error", { message: "Chat not found" });
          return;
        }

        if (existing.status === "CLOSED") {
          socket.emit("chat-closed", { chatId, reason: "Chat has been closed" });
          return;
        }

        if (!isAdmin) {
          userId = existing.userId;
          
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { isBanned: true },
          });

          if (user?.isBanned) {
            socket.emit("user-banned", { message: "You are banned from sending messages" });
            return;
          }
        } else {
          if (!userId) {
            const adminUser = await prisma.user.findFirst({
              where: { role: "ADMIN" },
            });
            if (adminUser) {
              userId = adminUser.id;
              console.log("Found admin user:", adminUser.id);
            } else {
              console.error("Admin user not found in database");
              socket.emit("chat-error", { message: "Admin user not found" });
              return;
            }
          } else {
            console.log("Using provided admin userId:", userId);
          }
        }

        if (!userId) {
          console.error("User ID is missing");
          socket.emit("chat-error", { message: "User ID is required" });
          return;
        }

        if (!payload.content || payload.content.trim().length === 0) {
          socket.emit("chat-error", { message: "Message content is required" });
          return;
        }

        const message = await prisma.message.create({
          data: {
            content: payload.content.trim(),
            isBot: isAdmin,
            chatId,
            userId,
          },
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

        console.log("Message created:", { 
          id: message.id, 
          isBot: message.isBot, 
          chatId: message.chatId,
          userId: message.userId 
        });

        await prisma.chatSession.update({
          where: { id: chatId },
          data: {
            status: "ACTIVE",
            closedAt: null,
            updatedAt: new Date(),
          },
        });

        const messageResponse = {
          id: message.id,
          content: message.content,
          isBot: message.isBot,
          createdAt: message.createdAt.toISOString(),
          sender: message.isBot ? "ADMIN" : "USER",
          userId: message.userId,
          user: message.user,
        };

        console.log("Broadcasting message to room:", chatId);
        io.to(chatId).emit("receive-message", {
          chatId,
          message: messageResponse,
        });

        socket.emit("message-sent", { chatId, messageId: message.id });

        if (!isAdmin) {
          const existingBotMessages = await prisma.message.count({
            where: {
              chatId,
              isBot: true,
            },
          });

          if (existingBotMessages === 0) {
            const settings = await prisma.adminSettings.findFirst();
            if (settings?.enableAutoResponse && settings?.autoResponseMessage && settings.autoResponseMessage.trim().length > 0) {
              setTimeout(async () => {
                const adminUser = await prisma.user.findFirst({
                  where: { role: "ADMIN" },
                });
                
                if (adminUser && settings.autoResponseMessage) {
                  const autoMessage = await prisma.message.create({
                    data: {
                      content: settings.autoResponseMessage,
                      isBot: true,
                      chatId,
                      userId: adminUser.id,
                    },
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

                  const autoMessageResponse = {
                    id: autoMessage.id,
                    content: autoMessage.content,
                    isBot: autoMessage.isBot,
                    createdAt: autoMessage.createdAt.toISOString(),
                    sender: "ADMIN" as const,
                    userId: autoMessage.userId,
                    user: autoMessage.user,
                  };

                  io.to(chatId).emit("receive-message", {
                    chatId,
                    message: autoMessageResponse,
                  });
                }
              }, 1000);
            }
          }
        }
      } catch (error) {
        console.error("send-message error:", error);
        socket.emit("chat-error", { 
          message: "Failed to send message",
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    });

    socket.on("disconnect", () => {
      console.log("Socket disconnected:", socket.id);
    });
  });
};
