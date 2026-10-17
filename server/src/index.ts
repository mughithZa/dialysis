import { config } from './config.js';
import { connectDb } from './db.js';
import { createApp } from './app.js';
import { startJobs } from './notify/jobs.js';

await connectDb();
startJobs();
createApp().listen(config.port, () => {
  console.log(`server listening on :${config.port}`);
});
