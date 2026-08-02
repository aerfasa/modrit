FROM node:18-bullseye
# نصب git و python3 برای پشتیبانی از همه نوع ربات
RUN apt-get update && apt-get install -y git python3 python3-pip
WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
