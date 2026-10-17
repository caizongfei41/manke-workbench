/** Fixed product configuration for the local 漫客工作台 (Manke workbench). */
export const appConfig = {
  app_url: 'http://127.0.0.1:3020',
  app_name: '漫客工作台',
  app_description:
    '本地优先的 ComfyUI 图像与视频创作工作台 — 化繁为简，自由创作。',
  app_logo: '/logo.png',
  database_url: 'file:data/local.db',
} as const;
