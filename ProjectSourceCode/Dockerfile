# ---------- Base Image ----------
FROM node:lts

# ---------- App Directory ----------
WORKDIR /app

# ---------- Copy dependency files first (for caching) ----------
COPY package.json package-lock.json ./

# Install dependencies
RUN npm install --production=false

# ---------- Copy all source code ----------
COPY . .

# ---------- Environment Variables ----------
# Render will inject PORT, DATABASE_URL, etc.
ENV NODE_ENV=production

# ---------- Expose the Render port ----------
EXPOSE 10000

# ---------- Start command ----------
# This is equivalent to your compose:
#   sh -c "npm run db:wait && npm start"
CMD ["sh", "-c", "npm run db:wait && npm start"]
