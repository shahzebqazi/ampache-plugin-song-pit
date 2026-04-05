import dotenv from 'dotenv';

dotenv.config();

const required = (name) => {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v.trim();
};

export const config = {
  jwtSecret: new TextEncoder().encode(required('SONGPIT_JWT_SECRET')),
  apiKey: required('SONGPIT_API_KEY'),
  stagingRoot: required('SONGPIT_STAGING_ROOT'),
  spaPublicUrl: required('SONGPIT_SPA_PUBLIC_URL').replace(/\/$/, ''),
  rateUploadMax: Number.parseInt(process.env.SONGPIT_RATE_UPLOAD_MAX ?? '60', 10),
  port: Number.parseInt(process.env.PORT ?? '3030', 10),
  host: process.env.HOST ?? '0.0.0.0',
};
