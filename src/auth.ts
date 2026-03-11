import type { Request, Response, NextFunction } from "express";
import { supabaseAnon } from "./db.js";

export interface AuthedRequest extends Request {
  userId?: string;
  authToken?: string;
}

export async function requireAuth(req: AuthedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ detail: "Credenciais inválidas" });
  }

  const token = authHeader.slice("Bearer ".length);
  const supabase = supabaseAnon(token);
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    return res.status(401).json({ detail: "Token inválido ou expirado" });
  }

  req.userId = data.user.id;
  req.authToken = token;
  return next();
}
