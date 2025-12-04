# ---------- Base Image ----------
FROM node:lts

# ---------- App Directory ----------
WORKDIR /app

# ---------- Copy dependency files first (for caching) ----------
COPY package.json ./

# Install dependencies
RUN npm install

# ---------- Copy all source code ----------
COPY . .

# ---------- Environment Variables ----------
# Render injects all env vars automatically.
ENV NODE_ENV=production

# ---------- Expose the Render port ----------
EXPOSE 10000

# ---------- Start command ----------
CMD ["sh", "-c", "npm run db:wait && npm start"]
