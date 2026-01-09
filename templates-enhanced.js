// ============================================
// WEBSITE TEMPLATES LIBRARY
// Professional templates for different industries
// Updated with 13 complete templates
// ============================================

const TEMPLATES = {
  landscaping: {
    name: "Green Valley Landscaping",
    industry: "Landscaping & Lawn Care",
    colorScheme: {
      primary: "#1a3a1a",
      accent: "#7cb342",
      dark: "#2d5016",
      light: "#faf8f3"
    },
    description: "Natural, organic design with wave transitions and eco-friendly aesthetics.",
    folder: "landscaping-template",
    fonts: { heading: "Lora", body: "Archivo" },
    bestFor: ["Landscaping", "Lawn Care", "Tree Service", "Garden Design", "Outdoor Services"]
  },

  autoDetailing: {
    name: "Precision Auto Detailing",
    industry: "Automotive Detailing",
    colorScheme: {
      primary: "#DC143C",
      accent: "#8B0000",
      dark: "#0a0a0a",
      grey: "#2a2a2a",
      light: "#ffffff"
    },
    description: "Aggressive automotive design with bold red accents and premium styling.",
    folder: "auto-detailing-template",
    fonts: { heading: "Montserrat", body: "Rajdhani" },
    bestFor: ["Auto Detailing", "Car Wash", "Ceramic Coating", "Paint Correction", "Mobile Detailing"]
  },

  salonSpa: {
    name: "Serenity Spa & Salon",
    industry: "Beauty & Wellness",
    colorScheme: {
      primary: "#B76E79",
      accent: "#8B4C5C",
      sage: "#A8B5A0",
      cream: "#FAF7F2",
      charcoal: "#2C2C2C"
    },
    description: "Elegant spa design with rose gold accents and calming aesthetics.",
    folder: "salon-spa-template",
    fonts: { heading: "Cormorant Garamond", body: "Montserrat" },
    bestFor: ["Spa", "Salon", "Massage", "Facial", "Beauty", "Wellness", "Hair", "Nail", "Esthetician"]
  },

  restaurant: {
    name: "Bella Vista Restaurant",
    industry: "Restaurant & Dining",
    colorScheme: {
      primary: "#6B4423",
      accent: "#D4AF37",
      cream: "#F5E6D3",
      dark: "#3E2723",
      light: "#FFFFFF"
    },
    description: "Warm, elegant restaurant design with food-focused aesthetics.",
    folder: "restaurant-template",
    fonts: { heading: "Playfair Display", body: "Open Sans" },
    bestFor: ["Restaurant", "Cafe", "Bistro", "Fine Dining", "Italian", "Steakhouse", "Bar & Grill"]
  },

  fitness: {
    name: "Peak Performance Gym",
    industry: "Fitness & Training",
    colorScheme: {
      primary: "#0EA5E9",
      accent: "#FACC15",
      black: "#0A0A0A",
      darkGrey: "#1A1A1A",
      light: "#FFFFFF"
    },
    description: "Bold, energetic fitness design with angular shapes and high energy.",
    folder: "fitness-template",
    fonts: { heading: "Bebas Neue", body: "Roboto" },
    bestFor: ["Gym", "Fitness", "Training", "CrossFit", "Yoga", "Pilates", "Boxing"]
  },

  dental: {
    name: "Bright Smile Dental",
    industry: "Dental Practice",
    colorScheme: {
      primary: "#14B8A6",
      accent: "#0F766E",
      white: "#FFFFFF",
      lightGrey: "#F8FAFC",
      charcoal: "#1E293B"
    },
    description: "Clean, clinical dental design with calming teal colors.",
    folder: "dental-template",
    fonts: { heading: "Nunito Sans", body: "Inter" },
    bestFor: ["Dental", "Dentist", "Orthodontics", "Family Dental", "Cosmetic Dentistry"]
  },

  realEstate: {
    name: "Premier Realty",
    industry: "Real Estate",
    colorScheme: {
      primary: "#1E3A8A",
      accent: "#F59E0B",
      white: "#FFFFFF",
      light: "#F3F4F6",
      charcoal: "#1F2937"
    },
    description: "Sophisticated luxury real estate with property showcase focus.",
    folder: "real-estate-template",
    fonts: { heading: "Merriweather", body: "Lato" },
    bestFor: ["Real Estate", "Realtor", "Property", "Homes", "Luxury Homes", "Realty"]
  },

  petGrooming: {
    name: "Pawsitive Grooming",
    industry: "Pet Grooming",
    colorScheme: {
      primary: "#9333EA",
      accent: "#6EE7B7",
      pink: "#F472B6",
      cream: "#FEF3C7",
      charcoal: "#374151"
    },
    description: "Playful, caring pet grooming with rounded shapes and fun colors.",
    folder: "pet-grooming-template",
    fonts: { heading: "Quicksand", body: "Poppins" },
    bestFor: ["Pet Grooming", "Dog Grooming", "Cat Grooming", "Pet Spa", "Veterinary"]
  },

  hvac: {
    name: "Climate Control Pro",
    industry: "HVAC & Plumbing",
    colorScheme: {
      primary: "#F97316",
      accent: "#1E40AF",
      grey: "#475569",
      light: "#F1F5F9",
      white: "#FFFFFF"
    },
    description: "Reliable HVAC design with emergency orange accents.",
    folder: "hvac-template",
    fonts: { heading: "Oswald", body: "Work Sans" },
    bestFor: ["HVAC", "Plumbing", "Air Conditioning", "Heating", "Furnace", "Emergency Services"]
  },

  photography: {
    name: "Lens & Light Photography",
    industry: "Photography",
    colorScheme: {
      primary: "#0A0A0A",
      accent: "#D4AF37",
      white: "#FFFFFF",
      grey: "#E5E5E5"
    },
    description: "Artistic, minimal photography with image-first layout.",
    folder: "photography-template",
    fonts: { heading: "Crimson Text", body: "Raleway" },
    bestFor: ["Photography", "Photographer", "Wedding Photography", "Portrait", "Event Photography"]
  },

  cleaning: {
    name: "Sparkle Clean",
    industry: "Cleaning Services",
    colorScheme: {
      primary: "#38BDF8",
      accent: "#10B981",
      white: "#FFFFFF",
      light: "#F0F9FF",
      charcoal: "#1F2937"
    },
    description: "Fresh, organized cleaning service with checklist focus.",
    folder: "cleaning-template",
    fonts: { heading: "Rubik", body: "Karla" },
    bestFor: ["Cleaning", "Maid", "Janitorial", "Housekeeping", "Commercial Cleaning"]
  },

  legal: {
    name: "Sterling & Associates",
    industry: "Law Firm",
    colorScheme: {
      primary: "#7C2D12",
      accent: "#CA8A04",
      charcoal: "#1C1917",
      cream: "#FEF3C7",
      white: "#FFFFFF"
    },
    description: "Professional, authoritative law firm with traditional styling.",
    folder: "legal-template",
    fonts: { heading: "EB Garamond", body: "Source Sans Pro" },
    bestFor: ["Law", "Legal", "Attorney", "Lawyer", "Legal Services"]
  },

  renovation: {
    name: "BuildRight Contractors",
    industry: "Home Renovation",
    colorScheme: {
      primary: "#475569",
      accent: "#B45309",
      wood: "#78350F",
      grey: "#E2E8F0",
      white: "#FFFFFF"
    },
    description: "Modern-rustic renovation with transformation focus.",
    folder: "renovation-template",
    fonts: { heading: "Archivo Black", body: "Mulish" },
    bestFor: ["Renovation", "Remodeling", "Contractor", "Construction", "Kitchen Remodel", "Home Improvement"]
  }
};

// Helper function to get template recommendation based on business type
function getRecommendedTemplate(businessType) {
  const businessTypeLower = businessType.toLowerCase();
  
  // Check all keywords for each template
  const keywordMap = {
    restaurant: ['restaurant', 'cafe', 'bistro', 'dining', 'eatery', 'bar', 'grill', 'food'],
    fitness: ['gym', 'fitness', 'training', 'crossfit', 'yoga', 'pilates', 'workout', 'exercise'],
    dental: ['dental', 'dentist', 'orthodonti', 'teeth', 'oral'],
    realEstate: ['real estate', 'realtor', 'property', 'homes', 'houses', 'realty'],
    petGrooming: ['pet', 'grooming', 'dog', 'cat', 'veterinary', 'vet', 'animal'],
    hvac: ['hvac', 'heating', 'cooling', 'air conditioning', 'furnace', 'plumbing', 'ac repair'],
    photography: ['photography', 'photographer', 'photo', 'wedding photography', 'portrait'],
    cleaning: ['cleaning', 'maid', 'janitorial', 'housekeeping', 'clean'],
    legal: ['law', 'legal', 'attorney', 'lawyer'],
    renovation: ['renovation', 'remodeling', 'contractor', 'construction', 'remodel', 'builder'],
    salonSpa: ['salon', 'spa', 'massage', 'facial', 'beauty', 'wellness', 'hair', 'nail', 'esthetician', 'skin'],
    autoDetailing: ['detailing', 'car', 'auto', 'vehicle', 'ceramic', 'paint', 'wash'],
    landscaping: ['landscaping', 'lawn', 'garden', 'tree', 'outdoor', 'yard']
  };
  
  // Find matching template
  for (const [templateKey, keywords] of Object.entries(keywordMap)) {
    if (keywords.some(keyword => businessTypeLower.includes(keyword))) {
      return templateKey;
    }
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
    fonts: template.fonts,
    folder: template.folder,
    cssVars: Object.entries(template.colorScheme)
      .map(([key, value]) => `  --${key}: ${value};`)
      .join('\n')
  };
}

module.exports = { 
  TEMPLATES, 
  getRecommendedTemplate, 
  getTemplateInfo 
};
