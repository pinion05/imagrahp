# imagraph — Railway 배포용 (최저비용: 서버리스 슬립 활성)
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY server ./server
COPY --from=build /app/dist ./dist
# .data는 ephemeral — 무료/최저비용: 볼륨 마운트 안함 (이미지 재생성시 리셋 허용)
EXPOSE 7837
CMD ["node", "server/index.js"]
