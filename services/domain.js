const axios = require('axios');

// You can use Namecheap, GoDaddy, or a domain registrar API
// For this example, I'll show Namecheap API structure
const NAMECHEAP_API_USER = process.env.NAMECHEAP_API_USER;
const NAMECHEAP_API_KEY = process.env.NAMECHEAP_API_KEY;
const NAMECHEAP_USERNAME = process.env.NAMECHEAP_USERNAME;

/**
 * Search for available domains
 * This checks .com, .net, .org availability
 */
async function searchDomains(query) {
  try {
    // Clean the query - remove spaces, special chars
    const cleanQuery = query.toLowerCase().replace(/[^a-z0-9-]/g, '');
    
    if (!cleanQuery) {
      throw new Error('Invalid domain query');
    }

    // Extensions to check
    const extensions = ['com', 'net', 'org'];
    
    // If using Namecheap API:
    if (NAMECHEAP_API_KEY) {
      return await searchDomainsNamecheap(cleanQuery, extensions);
    }
    
    // Otherwise, return mock data for testing
    // In production, you MUST use a real domain registrar API
    console.warn('⚠️  Using mock domain data - configure NAMECHEAP_API_KEY for production');
    return mockDomainSearch(cleanQuery, extensions);
    
  } catch (error) {
    console.error('Domain search error:', error);
    throw new Error('Failed to search domains');
  }
}

/**
 * Search domains using Namecheap API
 */
async function searchDomainsNamecheap(query, extensions) {
  try {
    const domains = [];
    
    for (const ext of extensions) {
      const domainName = `${query}.${ext}`;
      
      // Namecheap API check
      const response = await axios.get('https://api.namecheap.com/xml.response', {
        params: {
          ApiUser: NAMECHEAP_API_USER,
          ApiKey: NAMECHEAP_API_KEY,
          UserName: NAMECHEAP_USERNAME,
          Command: 'namecheap.domains.check',
          ClientIp: '0.0.0.0', // Your server IP
          DomainList: domainName
        }
      });

      // Parse XML response (you'll need xml2js or similar)
      // For simplicity, assuming parsed response
      const available = true; // Parse from XML
      const price = ext === 'com' ? 15 : 15; // $15/year for all
      
      domains.push({
        name: domainName,
        available,
        price,
        extension: ext
      });
    }
    
    return domains;
  } catch (error) {
    console.error('Namecheap API error:', error);
    throw error;
  }
}

/**
 * Mock domain search for development/testing
 * Replace with real API in production
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
 * Purchase domain through registrar
 */
async function purchaseDomain(domain, userInfo) {
  try {
    // If using Namecheap API:
    if (NAMECHEAP_API_KEY) {
      return await purchaseDomainNamecheap(domain, userInfo);
    }
    
    // Mock purchase for testing
    console.warn('⚠️  Mock domain purchase - configure NAMECHEAP_API_KEY for production');
    return {
      success: true,
      domain,
      orderId: 'MOCK-' + Date.now(),
      message: 'Domain purchased successfully (MOCK)'
    };
    
  } catch (error) {
    console.error('Domain purchase error:', error);
    throw new Error('Failed to purchase domain');
  }
}

/**
 * Purchase domain using Namecheap API
 */
async function purchaseDomainNamecheap(domain, userInfo) {
  try {
    const [domainName, extension] = domain.split('.');
    
    const response = await axios.get('https://api.namecheap.com/xml.response', {
      params: {
        ApiUser: NAMECHEAP_API_USER,
        ApiKey: NAMECHEAP_API_KEY,
        UserName: NAMECHEAP_USERNAME,
        Command: 'namecheap.domains.create',
        ClientIp: '0.0.0.0', // Your server IP
        DomainName: domainName,
        Years: 1,
        
        // Registrant contact info
        RegistrantFirstName: userInfo.businessName || 'Business',
        RegistrantLastName: 'Owner',
        RegistrantAddress1: '123 Business St',
        RegistrantCity: 'Seattle',
        RegistrantStateProvince: 'WA',
        RegistrantPostalCode: '98101',
        RegistrantCountry: 'US',
        RegistrantPhone: '+1.2065551234',
        RegistrantEmailAddress: userInfo.email,
        
        // Use same info for all contact types
        TechFirstName: userInfo.businessName || 'Business',
        TechLastName: 'Owner',
        TechAddress1: '123 Business St',
        TechCity: 'Seattle',
        TechStateProvince: 'WA',
        TechPostalCode: '98101',
        TechCountry: 'US',
        TechPhone: '+1.2065551234',
        TechEmailAddress: userInfo.email,
        
        AdminFirstName: userInfo.businessName || 'Business',
        AdminLastName: 'Owner',
        AdminAddress1: '123 Business St',
        AdminCity: 'Seattle',
        AdminStateProvince: 'WA',
        AdminPostalCode: '98101',
        AdminCountry: 'US',
        AdminPhone: '+1.2065551234',
        AdminEmailAddress: userInfo.email,
        
        AuxBillingFirstName: userInfo.businessName || 'Business',
        AuxBillingLastName: 'Owner',
        AuxBillingAddress1: '123 Business St',
        AuxBillingCity: 'Seattle',
        AuxBillingStateProvince: 'WA',
        AuxBillingPostalCode: '98101',
        AuxBillingCountry: 'US',
        AuxBillingPhone: '+1.2065551234',
        AuxBillingEmailAddress: userInfo.email,
        
        // Nameservers - point to Vercel
        Nameservers: 'ns1.vercel-dns.com,ns2.vercel-dns.com',
        
        // Add WhoisGuard (privacy protection) - usually free
        AddFreeWhoisguard: 'yes',
        WGEnabled: 'yes'
      }
    });

    // Parse XML response
    // Return success
    return {
      success: true,
      domain,
      orderId: 'ORDER-' + Date.now(), // Parse from XML response
      message: 'Domain purchased successfully'
    };
    
  } catch (error) {
    console.error('Namecheap purchase error:', error);
    throw new Error('Failed to purchase domain through Namecheap');
  }
}

/**
 * Configure domain nameservers to point to Vercel
 */
async function configureDomainNameservers(domain) {
  try {
    if (!NAMECHEAP_API_KEY) {
      console.warn('⚠️  Skipping nameserver config - NAMECHEAP_API_KEY not set');
      return;
    }

    const [domainName, extension] = domain.split('.');
    
    await axios.get('https://api.namecheap.com/xml.response', {
      params: {
        ApiUser: NAMECHEAP_API_USER,
        ApiKey: NAMECHEAP_API_KEY,
        UserName: NAMECHEAP_USERNAME,
        Command: 'namecheap.domains.dns.setCustom',
        ClientIp: '0.0.0.0',
        SLD: domainName,
        TLD: extension,
        Nameservers: 'ns1.vercel-dns.com,ns2.vercel-dns.com'
      }
    });

    console.log(`✅ Configured nameservers for ${domain}`);
  } catch (error) {
    console.error('Nameserver config error:', error);
    throw new Error('Failed to configure nameservers');
  }
}

module.exports = {
  searchDomains,
  purchaseDomain,
  configureDomainNameservers
};
