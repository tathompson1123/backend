// ============================================
// WEBSITE TEMPLATES LIBRARY
// Professional templates for different industries
// ============================================

const TEMPLATES = {
  landscaping: {
    name: "Green Valley Landscaping",
    industry: "Landscaping & Lawn Care",
    colorScheme: {
      primary: "#1a3a1a",      // Forest Green
      accent: "#7cb342",        // Lime Green
      dark: "#2d5016",          // Dark Green
      light: "#faf8f3"          // Cream
    },
    description: "A natural, organic design featuring smooth wave transitions, eco-friendly aesthetics, and nature-inspired elements perfect for landscaping, lawn care, and outdoor services.",
    features: [
      "Smooth wave transitions between sections",
      "Scroll-triggered fade and slide animations",
      "Nature-inspired color palette",
      "Service cards with hover effects",
      "Benefits-driven content sections",
      "Portfolio gallery with overlay captions",
      "Contact form with 25% off offer",
      "Trust banner with reviews",
      "Mobile-responsive design"
    ],
    pages: [
      "Homepage with hero, features, services preview, benefits, recent work",
      "Services page with 6 detailed packages",
      "Recent work portfolio with case studies",
      "Contact page with form and special offer"
    ],
    fonts: {
      heading: "Lora (serif)",
      body: "Archivo (sans-serif)"
    },
    bestFor: ["Landscaping", "Lawn Care", "Tree Service", "Garden Design", "Outdoor Services", "Home Services"]
  },

  autoDetailing: {
    name: "Precision Auto Detailing",
    industry: "Automotive Detailing & Car Care",
    colorScheme: {
      primary: "#DC143C",       // Crimson Red
      accent: "#8B0000",        // Dark Red
      dark: "#0a0a0a",          // Black
      grey: "#2a2a2a",          // Dark Grey
      light: "#ffffff"          // White
    },
    description: "An aggressive, modern automotive design with bold red accents, dark backgrounds, and premium styling perfect for car detailing, auto services, and vehicle care businesses.",
    features: [
      "Bold red, black, grey color scheme",
      "Aggressive automotive styling",
      "Wave transitions between sections",
      "Scroll-triggered animations",
      "Premium package displays (Bronze/Silver/Gold tiers)",
      "Service cards with pricing",
      "Before/after gallery grid",
      "Trust banner with star reviews",
      "20% off CTA with urgency",
      "Mobile-responsive design"
    ],
    pages: [
      "Homepage with hero, features, services, benefits, gallery",
      "Ceramic coatings page with 3 package tiers",
      "Detailing services page (template structure provided)",
      "Gallery page for portfolio (template structure provided)",
      "Contact page with booking form (template structure provided)"
    ],
    fonts: {
      heading: "Montserrat (bold, uppercase)",
      body: "Rajdhani (sans-serif)"
    },
    bestFor: ["Auto Detailing", "Car Wash", "Ceramic Coating", "Paint Correction", "Mobile Detailing", "Vehicle Care"]
  },

  salonSpa: {
    name: "Serenity Spa & Salon",
    industry: "Beauty & Wellness",
    colorScheme: {
      primary: "#B76E79",       // Rose Gold
      accent: "#8B4C5C",        // Deep Rose
      sage: "#A8B5A0",          // Sage Green
      cream: "#FAF7F2",         // Cream
      charcoal: "#2C2C2C",      // Charcoal
      light: "#FFFFFF"          // White
    },
    description: "An elegant, luxurious spa and salon design with soft rose gold accents, gentle animations, and a calming aesthetic perfect for beauty and wellness businesses.",
    features: [
      "Elegant serif typography (Cormorant Garamond)",
      "Soft gradient backgrounds",
      "Gentle floating animations",
      "Rose gold accent throughout",
      "Circular icon designs",
      "Premium photography aesthetics",
      "Scroll-triggered fade animations",
      "Trust banner with client reviews",
      "Benefit-driven content sections",
      "Multiple booking CTAs",
      "Mobile-responsive design"
    ],
    pages: [
      "Homepage with hero, signature treatments, benefits, testimonials",
      "Complete treatment menu (Facials, Massage, Hair services)",
      "Spa packages page with 3 curated bundles",
      "Gallery with before/after transformations",
      "Contact page with booking form and 20% off offer"
    ],
    fonts: {
      heading: "Cormorant Garamond (serif)",
      body: "Montserrat (sans-serif)"
    },
    bestFor: ["Day Spa", "Hair Salon", "Nail Salon", "Massage Therapy", "Medical Spa", "Beauty Clinic", "Facial Studio", "Wellness Center", "Esthetician"]
  }
};

// Helper function to get template recommendation
function getRecommendedTemplate(businessType) {
  const businessTypeLower = businessType.toLowerCase();
  
  // Salon/Spa keywords
  const salonKeywords = ['salon', 'spa', 'massage', 'facial', 'beauty', 'wellness', 'hair', 'nail', 'esthetician', 'skin', 'skincare'];
  if (salonKeywords.some(keyword => businessTypeLower.includes(keyword))) {
    return 'salonSpa';
  }
  
  // Auto detailing keywords
  const autoKeywords = ['detailing', 'car', 'auto', 'vehicle', 'ceramic', 'paint', 'wash'];
  if (autoKeywords.some(keyword => businessTypeLower.includes(keyword))) {
    return 'autoDetailing';
  }
  
  // Landscaping keywords
  const landscapingKeywords = ['landscaping', 'lawn', 'garden', 'tree', 'outdoor', 'yard'];
  if (landscapingKeywords.some(keyword => businessTypeLower.includes(keyword))) {
    return 'landscaping';
  }
  
  // Default to landscaping for general home services
  return 'landscaping';
}

// Get template info with colors
function getTemplateInfo(templateKey) {
  const template = TEMPLATES[templateKey];
  if (!template) return null;
  
  return {
    name: template.name,
    description: template.description,
    colors: template.colorScheme,
    features: template.features,
    pages: template.pages,
    fonts: template.fonts,
    cssVars: `
:root {
  --primary: ${template.colorScheme.primary};
  --accent: ${template.colorScheme.accent};
  ${template.colorScheme.dark ? `--dark: ${template.colorScheme.dark};` : ''}
  ${template.colorScheme.grey ? `--grey: ${template.colorScheme.grey};` : ''}
  --light: ${template.colorScheme.light};
}
    `.trim()
  };
}

module.exports = { 
  TEMPLATES, 
  getRecommendedTemplate, 
  getTemplateInfo 
};
