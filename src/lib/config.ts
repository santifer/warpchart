import config from "../../mission.config.json";

export const REPO: string = config.repo;
export const [OWNER, NAME] = REPO.split("/");
export const ACCENT: string = (config as { accent?: string }).accent ?? "cyan";
