const isProduction = process.env.NODE_ENV === 'production';
// A hard-coded fallback secret is only acceptable for local development and tests.
if (isProduction && !process.env.SESSION_SECRET) {
  throw new Error('SESSION_SECRET must be set when NODE_ENV=production');
}

export const config = {
  isProduction,
  mongoUrl: process.env.MONGO_URL ?? 'mongodb://127.0.0.1:27017/dialysis?replicaSet=rs0',
  sessionSecret: process.env.SESSION_SECRET || 'dev-secret-change-me',
  appTz: process.env.APP_TZ ?? 'Asia/Damascus',
  port: Number(process.env.PORT ?? 3000),
  vapidPublic: process.env.VAPID_PUBLIC ?? '',
  vapidPrivate: process.env.VAPID_PRIVATE ?? '',
  vapidSubject: process.env.VAPID_SUBJECT ?? 'mailto:admin@example.com',
};
