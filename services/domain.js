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
      const results = await searchDomainsDynadot(cleanQuery, extensions);
      
      // If all domains are taken, suggest alternatives
      const allTaken = results.every(d => !d.available);
      if (allTaken) {
        console.log('⚠️  All primary domains taken, generating alternatives...');
        const alternatives = await generateAlternatives(cleanQuery, extensions);
        return [...results, ...alternatives];
      }
      
      return results;
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
        // Dynadot expects 'domain0', 'domain1', etc. not 'domain'
        const params = {
          key: DYNADOT_API_KEY,
          command: 'search',
          domain0: domainName  // Changed from 'domain' to 'domain0'
        };
        
        // Add secret key if provided
        if (DYNADOT_SECRET_KEY) {
          params.secret = DYNADOT_SECRET_KEY;
        }
        
        console.log(`  API params:`, params);
        const response = await axios.get(DYNADOT_API_URL, { params });

        console.log(`  ✅ Got response from Dynadot`);
        const xmlData = response.data;
        console.log(`  Raw XML:`, xmlData.substring(0, 800)); // First 800 chars

        // Parse Dynadot XML response
        let available = false;
        
        // Check if request was successful first
        const isSuccess = xmlData.includes('<SuccessCode>0</SuccessCode>');
        
        if (isSuccess) {
          // Look for domain availability in the response
          // Dynadot returns <SearchResponse> with domain status
          
          // Method 1: Check for explicit available/unavailable status
          if (xmlData.includes('<Available>yes</Available>') || 
              xmlData.includes('<available>yes</available>')) {
            available = true;
          }
          
          // Method 2: Check if domain is in "available" section
          if (xmlData.match(new RegExp(`<Domain[^>]*>${domainName.replace('.', '\\.')}</Domain>.*?<Status>available</Status>`, 'i'))) {
            available = true;
          }
          
          // Method 3: If no explicit "unavailable" or "taken" message, assume available
          if (!xmlData.includes('unavailable') && 
              !xmlData.includes('not available') &&
              !xmlData.includes('already registered') &&
              !xmlData.includes('taken') &&
              xmlData.includes(domainName)) {
            available = true;
          }
        }
        
        // If response contains explicit unavailable indicators, mark as unavailable
        if (xmlData.includes('<Available>no</Available>') ||
            xmlData.includes('<available>no</available>') ||
            xmlData.includes('unavailable') ||
            xmlData.includes('not available') ||
            xmlData.includes('already registered')) {
          available = false;
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
        console.log(`  Success: ${isSuccess}`);

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
    
    // If all main domains are taken, suggest alternatives
    const allTaken = domains.every(d => !d.available);
    if (allTaken) {
      console.log('💡 All main domains taken, generating suggestions...');
      const suggestions = await generateDomainSuggestions(query, extensions);
      domains.push(...suggestions);
    }
    
    return domains;
  } catch (error) {
    console.error('Dynadot API error:', error.message);
    throw error;
  }
}

/**
 * Generate alternative domain suggestions
 */
async function generateDomainSuggestions(query, extensions) {
  const suggestions = [];
  
  // Create variations
  const variations = [
    `get${query}`,
    `${query}online`,
    `${query}pro`,
    `${query}hq`,
    `${query}official`,
    `the${query}`,
    `${query}site`
  ];
  
  console.log('  Checking variations:', variations.slice(0, 3).join(', '), '...');
  
  // Check first 3 variations for .com only
  for (let i = 0; i < Math.min(3, variations.length); i++) {
    const variation = variations[i];
    const domainName = `${variation}.com`;
    
    try {
      const params = {
        key: DYNADOT_API_KEY,
        command: 'search',
        domain0: domainName
      };
      
      if (DYNADOT_SECRET_KEY) {
        params.secret = DYNADOT_SECRET_KEY;
      }
      
      const response = await axios.get(DYNADOT_API_URL, { params });
      const xmlData = response.data;
      
      const isSuccess = xmlData.includes('<SuccessCode>0</SuccessCode>');
      let available = false;
      
      if (isSuccess) {
        if (xmlData.includes('<Available>yes</Available>') || 
            xmlData.includes('<available>yes</available>')) {
          available = true;
        }
        
        if (!xmlData.includes('unavailable') && 
            !xmlData.includes('not available') &&
            xmlData.includes(domainName)) {
          available = true;
        }
      }
      
      if (xmlData.includes('<Available>no</Available>') ||
          xmlData.includes('unavailable')) {
        available = false;
      }
      
      if (available) {
        console.log(`  ✅ Found available suggestion: ${domainName}`);
        suggestions.push({
          name: domainName,
          available: true,
          price: 15,
          extension: 'com',
          isSuggestion: true
        });
      }
      
      // Limit to 3 suggestions
      if (suggestions.length >= 3) break;
      
    } catch (error) {
      console.error(`  Error checking ${domainName}:`, error.message);
    }
  }
  
  return suggestions;
}

/**
 * Generate alternative domain suggestions when primary domains are taken
 */
async function generateAlternatives(query, extensions) {
  const alternatives = [];
  const suggestions = [
    `get${query}`,
    `${query}online`,
    `${query}pro`,
    `my${query}`,
    `${query}hq`,
    `the${query}`,
    `${query}now`,
    `${query}site`
  ];
  
  console.log('🔍 Checking alternatives for suggestions...');
  
  // Check availability of alternatives (limit to avoid too many API calls)
  for (let i = 0; i < Math.min(4, suggestions.length); i++) {
    const altQuery = suggestions[i];
    
    for (const ext of extensions) {
      const domainName = `${altQuery}.${ext}`;
      
      try {
        const params = {
          key: DYNADOT_API_KEY,
          command: 'search',
          domain0: domainName
        };
        
        if (DYNADOT_SECRET_KEY) {
          params.secret = DYNADOT_SECRET_KEY;
        }
        
        const response = await axios.get(DYNADOT_API_URL, { params });
        const xmlData = response.data;
        
        const isSuccess = xmlData.includes('<SuccessCode>0</SuccessCode>');
        let available = false;
        
        if (isSuccess) {
          if (!xmlData.includes('unavailable') && 
              !xmlData.includes('<Available>no</Available>') &&
              !xmlData.includes('not available') &&
              !xmlData.includes('already registered')) {
            available = true;
          }
        }
        
        if (xmlData.includes('<Available>no</Available>') ||
            xmlData.includes('unavailable') ||
            xmlData.includes('not available') ||
            xmlData.includes('already registered')) {
          available = false;
        }
        
        if (available) {
          alternatives.push({
            name: domainName,
            available: true,
            price: 15,
            extension: ext,
            isSuggestion: true
          });
          
          console.log(`  ✅ Alternative available: ${domainName}`);
          
          // Stop after finding 6 available alternatives
          if (alternatives.length >= 6) {
            return alternatives;
          }
        }
        
      } catch (error) {
        console.error(`  ⚠️  Error checking ${domainName}:`, error.message);
      }
    }
  }
  
  return alternatives;
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
