import { env } from "cloudflare:workers";
import { headers } from "next/headers";
import { getChatGPTUser } from "../app/chatgpt-auth";

export type GameUser = { userId:string; displayName:string };
export const SESSION_COOKIE = "pearson_market_session";
export const SESSION_LIFETIME_MS = 120 * 24 * 60 * 60 * 1000;

export function gameAuthMode() {
  return env.GAME_AUTH_MODE;
}

export function newSessionToken() {
  const bytes=crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+","-").replaceAll("/","_").replace(/=+$/g,"");
}

export async function hashToken(token:string) {
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(token));
  return [...new Uint8Array(bytes)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

function cookieValue(cookieHeader:string,name:string) {
  return cookieHeader.split(";").map((piece)=>piece.trim()).find((piece)=>piece.startsWith(`${name}=`))?.slice(name.length+1);
}

export async function getGameUser():Promise<GameUser|null> {
  if(gameAuthMode()==="site")return getChatGPTUser();
  if(gameAuthMode()!=="guest"||!env.DB)return null;
  const token=cookieValue((await headers()).get("cookie")??"",SESSION_COOKIE);
  if(!token||!/^[A-Za-z0-9_-]{43}$/.test(token))return null;
  const digest=await hashToken(token);
  const row=await env.DB.prepare("SELECT user_id,display_name FROM guest_sessions WHERE token_hash=? AND expires_at>?")
    .bind(digest,Date.now()).first<{user_id:string;display_name:string}>();
  return row?{userId:row.user_id,displayName:row.display_name}:null;
}
