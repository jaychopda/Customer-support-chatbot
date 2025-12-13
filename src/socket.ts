const Server = require("socket.io");
const HttpServer = require("http");

const initSocket = (server: any) => {
  const io = new Server(server, {
    cors: {
      origin: "*"
    }
  });

  io.on("connection", (socket : any) => {
    console.log("User connected:", socket.id);

    socket.on("disconnect", () => {
      console.log("User disconnected:", socket.id);
    });
  });
};

module.exports = { initSocket };