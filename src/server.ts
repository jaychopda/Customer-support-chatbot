import http from "http";
import dotenv from "dotenv";
import app from "./app";
import { initSocket } from "./socket"; // ✅ named import

dotenv.config();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// attach socket.io
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
