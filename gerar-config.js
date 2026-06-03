const fs = require('fs');

// Estrutura idêntica ao seu config.local.js, mas puxando do painel do Vercel
const conteudo = `
window.APP_CONFIG = {
  ADMIN_PASSWORD: "${process.env.ADMIN_PASSWORD || 'casemiro2026'}",
  MONITOR_PASSWORD: null,
  firebaseConfig: {
    apiKey: "${process.env.FIREBASE_API_KEY}",
    authDomain: "${process.env.FIREBASE_AUTH_DOMAIN}",
    databaseURL: "${process.env.FIREBASE_DATABASE_URL}",
    projectId: "${process.env.FIREBASE_PROJECT_ID}",
    storageBucket: "${process.env.FIREBASE_STORAGE_BUCKET}",
    messagingSenderId: "${process.env.FIREBASE_MESSAGING_SENDER_ID}",
    appId: "${process.env.FIREBASE_APP_ID}"
  }
};
`;

fs.writeFileSync('./config.local.js', conteudo);
console.log('✅ config.local.js gerado com sucesso para o ambiente do Vercel!');