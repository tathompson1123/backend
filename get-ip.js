// get-ip.js - Run this to find your Railway IP address

const axios = require('axios');

async function getPublicIP() {
  try {
    console.log('🔍 Fetching Railway public IP address...\n');
    
    const response = await axios.get('https://api.ipify.org?format=json');
    const ip = response.data.ip;
    
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`🌐 YOUR RAILWAY IP ADDRESS: ${ip}`);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📋 Steps to whitelist in Porkbun:');
    console.log('   1. Go to: https://porkbun.com/account/api');
    console.log('   2. Find "API Access" or "IP Restrictions"');
    console.log(`   3. Add this IP: ${ip}`);
    console.log('   4. Save and redeploy\n');
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error fetching IP:', error.message);
    process.exit(1);
  }
}

getPublicIP();
