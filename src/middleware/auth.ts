import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";

export interface AuthRequest extends Request {
  admin?: {
    id: string;
    email: string;
    name: string;
    role: string;
  };
}

export const requireAdmin = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const sessionId = req.cookies?.admin_session;

    if (!sessionId) {
      return res.status(401).json({ error: "Unauthorized - Please login" });
    }

    const session = await prisma.user.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isBanned: true,
      },
    });

    if (!session || session.role !== "ADMIN" || session.isBanned) {
      return res.status(403).json({ error: "Forbidden - Admin access required" });
    }

    req.admin = {
      id: session.id,
      email: session.email,
      name: session.name,
      role: session.role,
    };

    next();
  } catch (error) {
    console.error("Auth middleware error:", error);
    res.status(500).json({ error: "Authentication error" });
  }
};

