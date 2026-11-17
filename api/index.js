// Vercel entry point: every /api, /auth and /log request runs the same handler as the local server.
// The app's screens (the public folder) are served by Vercel directly.
import { handler } from "../server.js";

export default handler;
