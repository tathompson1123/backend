const axios = require('axios');

/**
 * DYNADOT DOMAIN SERVICE
 * No IP whitelisting required!
 * 
 * Setup:
 * 1. Create account at https://www.dynadot.com
 * 2. Go to Account → API Settings
 * 3. Enable API access (no IP restrictions!)
 * 4. Get your API key
 * 5. Add to .env: DYNADOT_API_KEY=your_key_here
 */

const DYNADOT_API_KEY = process.env.DYNADOT_API_KEY;
const DYNADOT_SECRET_KEY = process.env.DYNADOT_SECRET_KEY; // Optional
const DYNADOT_API_URL = 'https://api.dynadot.com/api3.xml';

// Log configuration status on startup
if (DYNADOT_API_KEY && DYNADOT_SECRET_KEY) {
  console.log('✅ Dynadot API configured - real domain purchases enabled');
  console.log('   Using API Key + Secret Key authentication');
} else if (DYNADOT_API_KEY) {
  console.warn('⚠️  Dynadot API Key found but Secret Key missing');
  console.warn('   Add DYNADOT_SECRET_KEY to environment variables');
} else {
  console.warn('⚠️  Dynadot API NOT configured - using mock mode');
  console.warn('   Add DYNADOT_API_KEY and DYNADOT_SECRET_KEY');
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
    
    // If using Dynadot API
    if (DYNADOT_API_KEY) {
      return await searchDomainsDynadot(cleanQuery, extensions);
    }
    
    // Mock data for testing
    console.warn('⚠️  Using mock domain data - configure DYNADOT_API_KEY for production');
    return mockDomainSearch(cleanQuery, extensions);
    
  } catch (error) {
    console.error('Domain search error:', error);
    throw new Error('Failed to search domains');
  }
}

/**
 * Search domains using Dynadot API
 */
async function searchDomainsDynadot(query, extensions) {
  try {
    if (!DYNADOT_API_KEY || !DYNADOT_SECRET_KEY) {
      throw new Error('Both DYNADOT_API_KEY and DYNADOT_SECRET_KEY are required');
    }
    
    const domains = [];
    
    console.log('🔍 Checking availability with Dynadot API for:', query);
    
    for (const ext of extensions) {
      const domainName = `${query}.${ext}`;
      
      try {
        console.log(`  Checking ${domainName}...`);
        
        // Check availability using Dynadot API
        const params = {
          key: DYNADOT_API_KEY,
          command: 'search',
          domain: domainName
        };
        
        // Add secret key if provided
        if (DYNADOT_SECRET_KEY) {
          params.secret = DYNADOT_SECRET_KEY;
        }
        
        const response = await axios.get(DYNADOT_API_URL, { params });

        console.log(`  ✅ Got response from Dynadot`);
        const xmlData = response.data;
        console.log(`  Raw XML:`, xmlData.substring(0, 800)); // First 800 chars

        // Dynadot returns different XML formats, check all possibilities
        let available = false;
        
        // Method 1: Check for <Available>yes</Available>
        if (xmlData.includes('<Available>yes</Available>')) {
          available = true;
        }
        
        // Method 2: Check for <Status>available</Status>
        if (xmlData.includes('<Status>available</Status>')) {
          available = true;
        }
        
        // Method 3: Check if response has error or unavailable
        if (xmlData.includes('<Available>no</Available>') || 
            xmlData.includes('<Status>unavailable</Status>') ||
            xmlData.includes('not available') ||
            xmlData.includes('already registered')) {
          available = false;
        }
        
        // Method 4: Check SearchResponse - if successful and has domain, it's available
        if (xmlData.includes('SearchResponse') && xmlData.includes('SuccessCode') && xmlData.includes(domainName)) {
          available = true;
        }
        
        // Extract price from XML (try multiple patterns)
        let price = 15; // Default
        const pricePatterns = [
          /<Price>([\d.]+)<\/Price>/,
          /<price>([\d.]+)<\/price>/,
          /<registration>([\d.]+)<\/registration>/,
          /<Registration>([\d.]+)<\/Registration>/
        ];
        
        for (const pattern of pricePatterns) {
          const match = xmlData.match(pattern);
          if (match) {
            price = Math.ceil(parseFloat(match[1]));
            break;
          }
        }

        console.log(`  ${domainName} is ${available ? 'AVAILABLE ✅' : 'NOT AVAILABLE ❌'}`);
        console.log(`  Price: $${price}/year`);

        domains.push({
          name: domainName,
          available,
          price,
          extension: ext
        });
        
      } catch (error) {
        console.error(`  ❌ ERROR checking ${domainName}:`);
        console.error(`     Message:`, error.message);
        console.error(`     Status:`, error.response?.status);
        console.error(`     Response:`, error.response?.data?.substring(0, 500));
        console.error(`     Full error:`, error.toString());
        
        domains.push({
          name: domainName,
          available: false,
          price: 15,
          extension: ext
        });
      }
    }
    
    return domains;
  } catch (error) {
    console.error('Dynadot API error:', error.message);
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
    price: 15,
    extension: ext
  }));
}

/**
 * Purchase domain through Dynadot
 */
async function purchaseDomain(domain, userInfo) {
  try {
    if (!DYNADOT_API_KEY) {
      throw new Error('Domain purchasing is not configured. Please add DYNADOT_API_KEY to environment variables.');
    }

    console.log('💳 Purchasing domain via Dynadot:', domain);

    // Build request params
    const params = {
      key: DYNADOT_API_KEY,
      command: 'register',
      domain: domain,
      duration: 1, // 1 year
      // Contact info
      'contact0.name': userInfo.businessName || 'Business Owner',
      'contact0.email': userInfo.email,
      'contact0.phone': '+1.2065551234', // Default phone
      // Use Dynadot privacy service
      privacy: 'full',
      // Set nameservers to Vercel
      'ns0': 'ns1.vercel-dns.com',
      'ns1': 'ns2.vercel-dns.com'
    };
    
    // Add secret key if provided
    if (DYNADOT_SECRET_KEY) {
      params.secret = DYNADOT_SECRET_KEY;
    }

    // Register domain
    const response = await axios.get(DYNADOT_API_URL, { params });

    const xmlData = response.data;
    
    // Check if successful
    if (xmlData.includes('<Status>success</Status>')) {
      console.log(`✅ Domain ${domain} purchased via Dynadot`);
      
      return {
        success: true,
        domain,
        orderId: 'DYNADOT-' + Date.now(),
        message: 'Domain purchased successfully'
      };
    } else {
      // Extract error message from XML
      const errorMatch = xmlData.match(/<Error>(.+?)<\/Error>/);
      const errorMessage = errorMatch ? errorMatch[1] : 'Domain registration failed';
      throw new Error(errorMessage);
    }
    
  } catch (error) {
    console.error('Dynadot purchase error:', error.message);
    throw new Error(error.message || 'Failed to purchase domain');
  }
}

/**
 * Update domain nameservers
 */
async function updateNameservers(domain) {
  try {
    if (!DYNADOT_API_KEY) {
      console.warn('⚠️  Skipping nameserver update - API key not configured');
      return;
    }

    const params = {
      key: DYNADOT_API_KEY,
      command: 'set_ns',
      domain: domain,
      'ns0': 'ns1.vercel-dns.com',
      'ns1': 'ns2.vercel-dns.com'
    };
    
    // Add secret key if provided
    if (DYNADOT_SECRET_KEY) {
      params.secret = DYNADOT_SECRET_KEY;
    }

    const response = await axios.get(DYNADOT_API_URL, { params });

    const xmlData = response.data;
    
    if (xmlData.includes('<Status>success</Status>')) {
      console.log(`✅ Updated nameservers for ${domain}`);
    } else {
      throw new Error('Failed to update nameservers');
    }
  } catch (error) {
    console.error('Nameserver update error:', error.message);
    throw error;
  }
}

/**
 * Get domain info
 */
async function getDomainInfo(domain) {
  try {
    if (!DYNADOT_API_KEY) return null;

    const params = {
      key: DYNADOT_API_KEY,
      command: 'domain_info',
      domain: domain
    };
    
    // Add secret key if provided
    if (DYNADOT_SECRET_KEY) {
      params.secret = DYNADOT_SECRET_KEY;
    }

    const response = await axios.get(DYNADOT_API_URL, { params });

    return response.data;
  } catch (error) {
    console.error('Get domain info error:', error.message);
    return null;
  }
}

module.exports = {
  searchDomains,
  purchaseDomain,
  updateNameservers,
  getDomainInfo
};
