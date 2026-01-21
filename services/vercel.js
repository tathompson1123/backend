const axios = require('axios');

const VERCEL_TOKEN = process.env.VERCEL_TOKEN;
const VERCEL_TEAM_ID = process.env.VERCEL_TEAM_ID;

if (!VERCEL_TOKEN) {
  console.warn('⚠️  VERCEL_TOKEN not configured - deployment features will not work');
}

/**
 * Deploy website to Vercel
 */
async function deployToVercel(userId, htmlContent) {
  try {
    const projectName = `website-${userId}`;
    
    // Create deployment
    const response = await axios.post(
      'https://api.vercel.com/v13/deployments',
      {
        name: projectName,
        files: [
          {
            file: 'index.html',
            data: htmlContent
          }
        ],
        projectSettings: {
          framework: null,
          buildCommand: null,
          installCommand: null,
          outputDirectory: null
        }
      },
      {
        headers: {
          'Authorization': `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
      }
    );

    const deploymentUrl = `https://${response.data.url}`;
    console.log(`✅ Deployed to Vercel: ${deploymentUrl}`);
    
    return deploymentUrl;
  } catch (error) {
    console.error('Vercel deployment error:', error.response?.data || error.message);
    throw new Error('Failed to deploy to Vercel');
  }
}

/**
 * Add custom domain to Vercel project
 */
async function addDomainToVercel(domain, userId) {
  try {
    const projectName = `website-${userId}`;

    // First, ensure project exists by getting or creating it
    await ensureProject(projectName);

    // Add domain to project
    await axios.post(
      `https://api.vercel.com/v10/projects/${projectName}/domains`,
      { name: domain },
      {
        headers: {
          'Authorization': `Bearer ${VERCEL_TOKEN}`,
          'Content-Type': 'application/json'
        },
        params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
      }
    );

    console.log(`✅ Domain ${domain} added to Vercel project ${projectName}`);
    return true;
  } catch (error) {
    console.error('Vercel add domain error:', error.response?.data || error.message);
    throw new Error('Failed to add domain to Vercel');
  }
}

/**
 * Check if domain is verified on Vercel
 */
async function checkDomainVerification(domain, userId) {
  try {
    const projectName = `website-${userId}`;

    // First ensure project exists
    try {
      await ensureProject(projectName);
    } catch (error) {
      console.warn('Could not ensure project exists:', error.message);
      return false;
    }

    const response = await axios.get(
      `https://api.vercel.com/v9/projects/${projectName}/domains/${domain}`,
      {
        headers: {
          'Authorization': `Bearer ${VERCEL_TOKEN}`
        },
        params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
      }
    );

    // Check if domain is verified
    const isVerified = response.data.verified === true;
    console.log(`Domain ${domain} verification status: ${isVerified}`);
    
    return isVerified;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`Domain ${domain} not found on Vercel (not added yet)`);
      return false;
    }
    console.error('Vercel check domain error:', error.response?.data || error.message);
    return false;
  }
}

/**
 * Remove domain from Vercel project
 */
async function removeDomainFromVercel(domain, userId) {
  try {
    const projectName = `website-${userId}`;

    // Check if project exists first
    try {
      await axios.get(
        `https://api.vercel.com/v9/projects/${projectName}`,
        {
          headers: {
            'Authorization': `Bearer ${VERCEL_TOKEN}`
          },
          params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
        }
      );
    } catch (error) {
      if (error.response?.status === 404) {
        console.log(`Project ${projectName} doesn't exist - nothing to remove`);
        return true; // Not an error - project doesn't exist
      }
      throw error;
    }

    // Project exists, try to remove domain
    await axios.delete(
      `https://api.vercel.com/v9/projects/${projectName}/domains/${domain}`,
      {
        headers: {
          'Authorization': `Bearer ${VERCEL_TOKEN}`
        },
        params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
      }
    );

    console.log(`✅ Domain ${domain} removed from Vercel`);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      console.log(`Domain ${domain} not found on project - already removed`);
      return true; // Not an error - domain already removed
    }
    console.error('Vercel remove domain error:', error.response?.data || error.message);
    throw new Error('Failed to remove domain from Vercel');
  }
}

/**
 * Ensure Vercel project exists
 */
async function ensureProject(projectName) {
  try {
    // Try to get project
    await axios.get(
      `https://api.vercel.com/v9/projects/${projectName}`,
      {
        headers: {
          'Authorization': `Bearer ${VERCEL_TOKEN}`
        },
        params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
      }
    );
    
    console.log(`✅ Project ${projectName} exists`);
    return true;
  } catch (error) {
    if (error.response?.status === 404) {
      // Project doesn't exist, create it
      try {
        await axios.post(
          'https://api.vercel.com/v9/projects',
          {
            name: projectName,
            framework: null
          },
          {
            headers: {
              'Authorization': `Bearer ${VERCEL_TOKEN}`,
              'Content-Type': 'application/json'
            },
            params: VERCEL_TEAM_ID ? { teamId: VERCEL_TEAM_ID } : {}
          }
        );
        
        console.log(`✅ Created Vercel project: ${projectName}`);
        return true;
      } catch (createError) {
        console.error('Failed to create project:', createError.response?.data || createError.message);
        throw new Error('Failed to create Vercel project');
      }
    } else {
      console.error('Error checking project:', error.response?.data || error.message);
      throw error;
    }
  }
}

module.exports = {
  deployToVercel,
  addDomainToVercel,
  checkDomainVerification,
  removeDomainFromVercel
};
