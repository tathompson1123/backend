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
        
        const response = await axios.get(DYNADOT_API_URL, { params });
        const xmlData = response.data;

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
        console.error(`  ❌ ERROR checking ${domainName}:`, error.message);
        
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
  
  // Create more unique variations
  const currentYear = new Date().getFullYear();
  const variations = [
    `${query}${currentYear}`,  // thompsonsauto2026
    `${query}hq`,              // thompsonsautohq
    `${query}official`,        // thompsonsautoofficial
    `my${query}`,              // mythompsonsauto
    `${query}pro`,             // thompsonsautopro
    `get${query}`,             // getthompsonsauto
    `${query}online`,          // thompsonsautoonline
    `the${query}`,             // thethompsonsauto
    `${query}now`,             // thompsonsautonow
    `${query}site`             // thompsonsautosite
  ];
  
  console.log('  Checking variations:', variations.slice(0, 4).join(', '), '...');
  
  // Check variations - try to find at least 3 available
  for (const variation of variations) {
    // Try .com first
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
        // Check if available
        if (xmlData.includes('<Available>yes</Available>')) {
          available = true;
        }
        
        // If no explicit unavailable marker, check further
        if (!xmlData.includes('<Available>no</Available>') &&
            !xmlData.includes('unavailable') && 
            !xmlData.includes('not available')) {
          // Likely available
          available = true;
        }
      }
      
      // Explicit unavailable markers
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
        
        // Stop after finding 4 suggestions
        if (suggestions.length >= 4) break;
      } else {
        console.log(`  ❌ ${domainName} is taken`);
      }
      
    } catch (error) {
      console.error(`  ⚠️  Error checking ${domainName}:`, error.message);
    }
  }
  
  console.log(`  Found ${suggestions.length} available suggestions`);
  return suggestions;
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

    // Build request params — Dynadot API3 register command
    const params = {
      key: DYNADOT_API_KEY,
      command: 'register',
      domain: domain,
      duration: 1, // 1 year
      // Use Dynadot privacy/WHOIS proxy
      privacy: 'full',
      // Set nameservers to Vercel
      ns0: 'ns1.vercel-dns.com',
      ns1: 'ns2.vercel-dns.com'
    };

    // Add secret key if provided
    if (DYNADOT_SECRET_KEY) {
      params.secret = DYNADOT_SECRET_KEY;
    }

    // Register domain
    const response = await axios.get(DYNADOT_API_URL, { params });
    const xmlData = response.data;

    // Dynadot API3 uses <SuccessCode>0</SuccessCode> for success
    const isSuccess = xmlData.includes('<SuccessCode>0</SuccessCode>') ||
                      xmlData.includes('<Status>success</Status>');

    if (isSuccess) {
      console.log(`✅ Domain ${domain} purchased via Dynadot`);

      return {
        success: true,
        domain,
        orderId: 'DYNADOT-' + Date.now(),
        message: 'Domain purchased successfully'
      };
    } else {
      // Check for specific known error statuses first
      if (xmlData.includes('<Status>insufficient_funds</Status>')) {
        console.error(`❌ Dynadot registration failed: insufficient funds`);
        console.error('  Full response:', xmlData);
        throw new Error('Your Dynadot account has insufficient funds. Please top up your balance at dynadot.com and try again.');
      }

      // Extract error message from XML (try multiple patterns)
      const errorPatterns = [
        /<Status>(.+?)<\/Status>/i,
        /<Error>(.+?)<\/Error>/i,
        /<ErrorMessage>(.+?)<\/ErrorMessage>/i,
        /<Message>(.+?)<\/Message>/i,
        /<ResponseMessage>(.+?)<\/ResponseMessage>/i
      ];

      let errorMessage = 'Domain registration failed';
      for (const pattern of errorPatterns) {
        const match = xmlData.match(pattern);
        if (match && match[1] !== 'success') {
          errorMessage = match[1];
          break;
        }
      }

      console.error(`❌ Dynadot registration failed: ${errorMessage}`);
      console.error('  Full response:', xmlData);
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
    if (!DYNADOT_API_KEY || !DYNADOT_SECRET_KEY) {
      throw new Error('DYNADOT_API_KEY and DYNADOT_SECRET_KEY are required to update nameservers');
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
    console.log(`🔍 Nameserver update response for ${domain}:`, xmlData);

    // Dynadot API3 uses <SuccessCode>0</SuccessCode> for success (not <Status>success</Status>)
    if (xmlData.includes('<SuccessCode>0</SuccessCode>') || xmlData.includes('<Status>success</Status>')) {
      console.log(`✅ Updated nameservers for ${domain} → ns1.vercel-dns.com, ns2.vercel-dns.com`);
    } else {
      const errorMatch = xmlData.match(/<Error>(.+?)<\/Error>/i) || xmlData.match(/<Status>(.+?)<\/Status>/i);
      const errorMsg = errorMatch ? errorMatch[1] : 'Unknown error';
      throw new Error(`Failed to update nameservers: ${errorMsg}`);
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
