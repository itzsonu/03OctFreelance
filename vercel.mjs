import { routes, deploymentEnv } from "@vercel/config/v1";
import { createHostingConfig } from "./deploy/hostingConfig.mjs";

export const config = createHostingConfig(process.env, routes, deploymentEnv);
