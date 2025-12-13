const http = require("http");
const dotenv = require("dotenv");
const app = require("./app");
const {initSocket} = require("./socket");

dotenv.config();

const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// attach socket.io
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
