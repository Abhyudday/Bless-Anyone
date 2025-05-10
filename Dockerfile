# Use Node.js LTS version
FROM node:18-slim

# Create app directory
WORKDIR /usr/src/app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy app source
COPY . .

# Expose port (if needed)
EXPOSE 3000

# Start the bot
CMD [ "node", "bot.js" ] 