const express = require("express");
const cors = require("cors");
import adminRoutes from "./routes/admin.routes";


const app = express();

app.use(cors());
app.use(express.json());

app.use("/admin", adminRoutes);


app.get("/", (req: Request, res: any) => {
    res.send("API is running...");
});

export default app;
module.exports = app;
