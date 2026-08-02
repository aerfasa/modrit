FROM node:18-bullseye

# نصب پایتون و pip با قابلیت رفع خطای شبکه
RUN apt-get update && \
    apt-get install -y --fix-missing python3 python3-pip && \
    apt-get clean && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install
COPY . .
CMD ["npm", "start"]
