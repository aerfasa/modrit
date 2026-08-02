FROM node:18-bullseye
RUN apt-get update && apt-get install -y --fix-missing python3 python3-pip
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
