const axios = require('axios');

/**
 * PORKBUN DOMAIN SERVICE
 * Simpler alternative to Namecheap
 * 
 * Why Porkbun?
 * - Simpler API than Namecheap
 * - No IP whitelisting required
 * - Cheaper domains (~$9/year .com)
 * - Good API documentation
 * 
 * Setup:
 * 1. Create account at https://porkbun.com
 * 2. Enable API access in account settings
 * 3. Get API key and secret key
 * 4. Add to .env:
 *    PORKBUN_API_KEY=pk1_xxx
 *    PORKBUN_SECRET_KEY=sk1_xxx
 */

const PORKBUN_API_KEY = process.env.PORKBUN_API_KEY;
const PORKBUN_SECRET_KEY = process.env.PORKBUN_SECRET_KEY;
const PORKBUN_API_URL = 'https://porkbun.com/api/json/v3';

// Log configuration status on startup
if (PORKBUN_API_KEY && PORKBUN_SECRET_KEY) {
  console.log('✅ Porkbun API configured - real domain purchases enabled');
} else {
  console.warn('⚠️  Porkbun API NOT configured - using mock mode (add PORKBUN_API_KEY and PORKBUN_SECRET_KEY)');
}

/**
 * Search for available domains
 */
async function searchDomains(query) {
  try {
    const cleanQuery = query.toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    if (!cleanQuery) {
      throw new Error('Invalid domain query');
    }

    const extensions = ['com', 'net', 'org'];
    
    // If using Porkbun API
    if (PORKBUN_API_KEY && PORKBUN_SECRET_KEY) {
      return await searchDomainsPorkbun(cleanQuery, extensions);
    }
    
    // Mock data for testing - but warn user
    console.warn('⚠️  Using mock domain data - configure PORKBUN API keys for production');
    console.warn('⚠️  Mock availability checks are NOT accurate - domains may not actually be available');
    return mockDomainSearch(cleanQuery, extensions);
    
  } catch (error) {
    console.error('Domain search error:', error);
    throw new Error('Failed to search domains');
  }
}

/**
 * Search domains using Porkbun API
 */
async function searchDomainsPorkbun(query, extensions) {
  try {
    const domains = [];
    
    for (const ext of extensions) {
      const domainName = `${query}.${ext}`;
      
      try {
        // Check availability
        const response = await axios.post(
          `${PORKBUN_API_URL}/domain/checkAvailability/${domainName}`,
          {
            apikey: PORKBUN_API_KEY,
            secretapikey: PORKBUN_SECRET_KEY
          }
        );

        const available = response.data.status === 'SUCCESS' && 
                         response.data.availability === 'available';

        // Get pricing
        let price = 15; // Default $15/year
        try {
          const pricingResponse = await axios.post(
            `${PORKBUN_API_URL}/pricing/get`,
            {
              apikey: PORKBUN_API_KEY,
              secretapikey: PORKBUN_SECRET_KEY
            }
          );
          
          if (pricingResponse.data.status === 'SUCCESS') {
            const tldPricing = pricingResponse.data.pricing[ext];
            if (tldPricing && tldPricing.registration) {
              // Get yearly price and add small markup
              // Porkbun charges ~$9-11/year, we charge $15/year
              price = 15; // Fixed $15/year
            }
          }
        } catch (pricingError) {
          console.warn('Could not fetch pricing:', pricingError.message);
        }

        domains.push({
          name: domainName,
          available,
          price,
          extension: ext
        });
        
      } catch (error) {
        // If domain check fails, assume not available
        domains.push({
          name: domainName,
          available: false,
          price: 15, // $15/year
          extension: ext
        });
      }
    }
    
    return domains;
  } catch (error) {
    console.error('Porkbun API error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Mock domain search for development
 */
function mockDomainSearch(query, extensions) {
  return extensions.map(ext => ({
    name: `${query}.${ext}`,
    available: true,
    price: 15, // $15/year
    extension: ext
  }));
}

/**
 * Purchase domain through Porkbun
 */
async function purchaseDomain(domain, userInfo) {
  try {
    if (!PORKBUN_API_KEY || !PORKBUN_SECRET_KEY) {
      throw new Error('Domain purchasing is not configured. Please add PORKBUN_API_KEY and PORKBUN_SECRET_KEY to environment variables.');
    }

    // Register domain with Porkbun
    const response = await axios.post(
      `${PORKBUN_API_URL}/domain/create/${domain}`,
      {
        apikey: PORKBUN_API_KEY,
        secretapikey: PORKBUN_SECRET_KEY,
        
        // Contact information
        name: userInfo.businessName || 'Business Owner',
        email: userInfo.email,
        
        // Use Porkbun's privacy service
        privacyEnabled: true,
        
        // Set nameservers to Vercel
        nameservers: [
          'ns1.vercel-dns.com',
          'ns2.vercel-dns.com'
        ]
      }
    );

    if (response.data.status !== 'SUCCESS') {
      throw new Error(response.data.message || 'Domain registration failed');
    }

    console.log(`✅ Domain ${domain} purchased via Porkbun`);
    
    return {
      success: true,
      domain,
      orderId: response.data.orderId || 'PORKBUN-' + Date.now(),
      message: 'Domain purchased successfully'
    };
    
  } catch (error) {
    console.error('Porkbun purchase error:', error.response?.data || error.message);
    throw new Error(error.response?.data?.message || error.message || 'Failed to purchase domain');
  }
}

/**
 * Update domain nameservers (if not set during purchase)
 */
async function updateNameservers(domain) {
  try {
    if (!PORKBUN_API_KEY || !PORKBUN_SECRET_KEY) {
      console.warn('⚠️  Skipping nameserver update - API keys not configured');
      return;
    }

    const response = await axios.post(
      `${PORKBUN_API_URL}/domain/updateNameservers/${domain}`,
      {
        apikey: PORKBUN_API_KEY,
        secretapikey: PORKBUN_SECRET_KEY,
        nameservers: [
          'ns1.vercel-dns.com',
          'ns2.vercel-dns.com'
        ]
      }
    );

    if (response.data.status !== 'SUCCESS') {
      throw new Error('Failed to update nameservers');
    }

    console.log(`✅ Updated nameservers for ${domain}`);
  } catch (error) {
    console.error('Nameserver update error:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Get domain info
 */
async function getDomainInfo(domain) {
  try {
    const response = await axios.post(
      `${PORKBUN_API_URL}/domain/listAll`,
      {
        apikey: PORKBUN_API_KEY,
        secretapikey: PORKBUN_SECRET_KEY
      }
    );

    if (response.data.status === 'SUCCESS') {
      const domainInfo = response.data.domains?.find(d => d.domain === domain);
      return domainInfo || null;
    }
    
    return null;
  } catch (error) {
    console.error('Get domain info error:', error);
    return null;
  }
}

module.exports = {
  searchDomains,
  purchaseDomain,
  updateNameservers,
  getDomainInfo
};
