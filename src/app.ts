const express = require("express");
const cors = require("cors");
const { Request, Response } = require("express");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/", (req: Request, res: any) => {
    res.send("API is running...");
});
module.exports = app;
