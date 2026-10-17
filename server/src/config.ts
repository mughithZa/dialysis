export const config = {
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/dialysis?replicaSet=rs0',
  sessionSecret: process.env.SESSION_SECRET ?? 'dev-secret-change-me',
  appTz: process.env.APP_TZ ?? 'Asia/Damascus',
  port: Number(process.env.PORT ?? 3000),
  vapidPublic: process.env.VAPID_PUBLIC ?? '',
  vapidPrivate: process.env.VAPID_PRIVATE ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
};
