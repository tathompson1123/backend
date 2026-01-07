// ============================================
// COMPREHENSIVE IMAGE GUIDANCE FOR SERVICE BUSINESSES
// Add this to your visual_supremacy_prompt.js file
// ============================================

function getImageGuidance(businessType) {
  const type = businessType.toLowerCase();
  
  // ============================================
  // TOP 10 MOST POPULAR SERVICE BUSINESSES
  // ============================================
  
  // 1. CLEANING SERVICES (Most popular)
  if (type.includes('clean') || type.includes('maid') || type.includes('janitorial')) {
    return {
      hero: 'spotless-home,professional-cleaning,clean-modern-interior,bright-clean-space',
      serviceKeywords: [
        'residential-cleaning,house-cleaning,spotless-home,vacuum',
        'office-cleaning,commercial-cleaning,professional-workspace,clean-office',
        'deep-cleaning,spring-cleaning,thorough-cleaning,sanitizing',
        'carpet-cleaning,floor-cleaning,steam-cleaning,professional-equipment',
        'window-cleaning,sparkling-windows,glass-cleaning,professional',
        'move-out-cleaning,post-construction,cleaning-service,empty-room'
      ],
      about: 'cleaning-team,professional-cleaners,cleaning-supplies,uniform-team',
      guidelines: `
**Image Guidelines for Cleaning Services:**
- Hero: Sparkling clean modern home/office, bright natural light, spotless
- Service cards: Professional cleaners at work, clean results, modern equipment
- About: Team in branded uniforms, professional cleaning supplies, organized
- ❌ AVOID: Messy "before" photos, dirty spaces, unprofessional appearance
- ✅ SHOW: Spotless results, happy team members, professional equipment, satisfied customers
      `
    };
  }
  
  // 2. LANDSCAPING & LAWN CARE
  if (type.includes('land') || type.includes('lawn') || type.includes('yard')) {
    return {
      hero: 'beautiful-garden,professional-landscaping,lush-lawn,landscape-design',
      serviceKeywords: [
        'lawn-mowing,grass-cutting,green-lawn,striped-lawn,professional',
        'tree-trimming,tree-pruning,arborist,tree-care,professional-service',
        'garden-design,flower-beds,landscape-design,colorful-garden,planting',
        'hardscaping,patio-installation,outdoor-living,stone-work,pavers',
        'irrigation-system,sprinkler-installation,lawn-watering,professional',
        'mulching,edging,landscape-maintenance,garden-care,professional'
      ],
      about: 'landscaping-crew,lawn-equipment,professional-landscapers,work-truck',
      guidelines: `
**Image Guidelines for Landscaping:**
- Hero: Beautifully maintained property, professional landscape design, vibrant
- Service cards: Teams performing specific services, quality equipment, clean results
- About: Professional crew with commercial equipment, organized, branded vehicles
- ❌ AVOID: Overgrown yards, dead plants, messy work sites, unprofessional
- ✅ SHOW: Lush lawns, well-maintained gardens, professional equipment, satisfied results
      `
    };
  }
  
  // 3. AUTO DETAILING & CAR WASH
  if (type.includes('auto') || type.includes('detail') || type.includes('car wash') || type.includes('mobile detail')) {
    return {
      hero: 'luxury-car-detailing,showroom-shine,professional-car-wash,gleaming-vehicle',
      serviceKeywords: [
        'car-interior-detailing,leather-cleaning,vacuum-interior,spotless-interior',
        'car-exterior-polish,paint-correction,ceramic-coating,glossy-finish',
        'wheel-cleaning,tire-shine,rim-detailing,professional-wheels',
        'headlight-restoration,paint-protection,wax-application,professional-finish',
        'engine-bay-cleaning,undercarriage-wash,full-detail,complete-service',
        'mobile-detailing,on-site-service,convenience,professional-mobile'
      ],
      about: 'car-detailers,detailing-bay,professional-equipment,quality-tools',
      guidelines: `
**Image Guidelines for Auto Detailing:**
- Hero: Luxury car with perfect shine, professional detailing bay, showroom quality
- Service cards: Close-up shots of work (interior, exterior, wheels, paint)
- About: Professional detailers with equipment, clean modern facility
- ❌ AVOID: Dirty cars, generic car photos, accidents, unprofessional settings
- ✅ SHOW: Showroom-quality finishes, professional tools, gleaming results, happy customers
      `
    };
  }
  
  // 4. PLUMBING SERVICES
  if (type.includes('plumb')) {
    return {
      hero: 'modern-bathroom,luxury-fixtures,professional-plumbing,clean-installation',
      serviceKeywords: [
        'plumber-at-work,pipe-installation,professional-plumber,licensed-technician',
        'bathroom-renovation,modern-fixtures,luxury-bathroom,quality-installation',
        'kitchen-plumbing,sink-installation,faucet-repair,modern-kitchen',
        'water-heater,tankless-heater,professional-installation,modern-equipment',
        'drain-cleaning,pipe-repair,professional-service,quality-work',
        'emergency-plumbing,24-7-service,fast-response,professional-emergency'
      ],
      about: 'licensed-plumber,plumbing-tools,service-truck,professional-technician',
      guidelines: `
**Image Guidelines for Plumbing:**
- Hero: Modern, clean bathroom or kitchen with quality fixtures, professional
- Service cards: Professional plumber installing/repairing, clean work, quality
- About: Licensed plumbers with tools, branded service vehicles, professional
- ❌ AVOID: Leaky pipes, flooded basements, emergency disasters, messy work
- ✅ SHOW: Quality installations, modern fixtures, professional technicians, clean work
      `
    };
  }
  
  // 5. HVAC SERVICES
  if (type.includes('hvac') || type.includes('heating') || type.includes('cooling') || type.includes('air condition')) {
    return {
      hero: 'modern-hvac-system,air-conditioning-unit,professional-installation,clean-system',
      serviceKeywords: [
        'hvac-technician,ac-installation,professional-service,licensed-tech',
        'furnace-repair,heating-system,winter-heating,professional-maintenance',
        'air-conditioning,ac-unit,cooling-system,summer-comfort,modern-ac',
        'hvac-maintenance,filter-replacement,system-tune-up,professional-care',
        'ductwork,air-quality,ventilation,professional-ductwork,clean-air',
        'emergency-hvac,24-7-service,hvac-repair,fast-response'
      ],
      about: 'hvac-technician,professional-tools,service-van,licensed-contractor',
      guidelines: `
**Image Guidelines for HVAC:**
- Hero: Modern HVAC system, clean installation, professional work, quality equipment
- Service cards: Technicians servicing units, professional equipment, quality work
- About: Licensed technicians with tools, branded service vehicles, professional
- ❌ AVOID: Broken units, dirty systems, unprofessional work, emergency situations
- ✅ SHOW: Clean installations, modern equipment, professional service, comfort
      `
    };
  }
  
  // 6. PAINTING SERVICES
  if (type.includes('paint') && !type.includes('auto')) {
    return {
      hero: 'freshly-painted-room,interior-painting,modern-colors,professional-finish',
      serviceKeywords: [
        'interior-painting,room-painting,wall-painting,fresh-paint,modern-colors',
        'exterior-painting,house-painting,professional-painters,quality-finish',
        'cabinet-painting,kitchen-refinishing,cabinet-transformation,modern-kitchen',
        'commercial-painting,office-painting,professional-commercial,large-scale',
        'deck-staining,fence-painting,outdoor-painting,wood-staining',
        'paint-sprayer,professional-equipment,painting-tools,quality-supplies'
      ],
      about: 'painting-crew,professional-painters,painting-equipment,work-truck',
      guidelines: `
**Image Guidelines for Painting:**
- Hero: Freshly painted room, professional finish, modern colors, clean lines
- Service cards: Painters at work, quality finishes, professional technique
- About: Professional crew with equipment, paint supplies, organized team
- ❌ AVOID: Messy paint jobs, drips, unprofessional work, paint spills
- ✅ SHOW: Clean lines, professional finishes, modern colors, satisfied customers
      `
    };
  }
  
  // 7. ELECTRICAL SERVICES
  if (type.includes('electric') || type.includes('electrician')) {
    return {
      hero: 'modern-electrical-panel,professional-electrician,safe-installation,quality-wiring',
      serviceKeywords: [
        'electrician-at-work,electrical-installation,licensed-electrician,professional-service',
        'lighting-installation,modern-lighting,led-lights,professional-lighting',
        'electrical-panel,circuit-breaker,panel-upgrade,modern-electrical',
        'outlet-installation,switch-installation,electrical-wiring,professional-work',
        'ceiling-fan-installation,fixture-installation,electrical-upgrade,quality-work',
        'emergency-electrical,electrical-repair,troubleshooting,24-7-service'
      ],
      about: 'licensed-electrician,electrical-tools,service-van,professional-technician',
      guidelines: `
**Image Guidelines for Electrical:**
- Hero: Modern electrical work, professional installation, safe wiring, quality
- Service cards: Electricians working safely, professional installations, modern fixtures
- About: Licensed electricians with tools, branded vehicles, professional equipment
- ❌ AVOID: Exposed wires, electrical hazards, unsafe work, unprofessional
- ✅ SHOW: Safe installations, modern fixtures, professional work, quality results
      `
    };
  }
  
  // 8. ROOFING SERVICES
  if (type.includes('roof')) {
    return {
      hero: 'new-roof,quality-roofing,professional-installation,modern-home',
      serviceKeywords: [
        'roof-installation,new-roof,shingle-installation,professional-roofers',
        'roof-repair,leak-repair,storm-damage,emergency-roofing,professional-fix',
        'roof-inspection,drone-inspection,professional-assessment,quality-inspection',
        'gutter-installation,gutter-repair,downspout,professional-gutters',
        'metal-roofing,tile-roofing,flat-roof,commercial-roofing,quality-materials',
        'roofing-crew,safety-equipment,professional-roofers,work-in-progress'
      ],
      about: 'roofing-crew,safety-harness,professional-roofers,work-truck',
      guidelines: `
**Image Guidelines for Roofing:**
- Hero: Beautiful new roof, quality installation, professional work, modern home
- Service cards: Roofers working safely, professional installation, quality materials
- About: Professional crew with safety equipment, organized team, branded vehicles
- ❌ AVOID: Damaged roofs, storm damage "before" shots, unsafe work practices
- ✅ SHOW: Quality installations, safety measures, professional crews, beautiful results
      `
    };
  }
  
  // 9. PEST CONTROL
  if (type.includes('pest') || type.includes('exterminator') || type.includes('termite')) {
    return {
      hero: 'pest-free-home,professional-pest-control,safe-treatment,clean-home',
      serviceKeywords: [
        'pest-control-technician,professional-exterminator,licensed-tech,uniform',
        'termite-inspection,termite-treatment,wood-inspection,professional-service',
        'rodent-control,mouse-trap,pest-prevention,professional-solution',
        'bed-bug-treatment,heat-treatment,professional-extermination,effective-solution',
        'mosquito-control,outdoor-treatment,yard-spraying,professional-spray',
        'commercial-pest-control,restaurant-service,food-safety,professional'
      ],
      about: 'pest-control-team,service-vehicle,professional-equipment,licensed-technician',
      guidelines: `
**Image Guidelines for Pest Control:**
- Hero: Clean, pest-free home, professional service, safe environment
- Service cards: Technicians in uniform, professional equipment, safe treatments
- About: Licensed technicians, branded vehicles, professional equipment
- ❌ AVOID: Graphic pest images, infestations, scary photos, unprofessional
- ✅ SHOW: Professional technicians, safe treatments, happy homeowners, clean results
      `
    };
  }
  
  // 10. HANDYMAN SERVICES
  if (type.includes('handyman') || type.includes('handyperson') || type.includes('general maintenance')) {
    return {
      hero: 'home-repair,professional-handyman,quality-work,modern-home',
      serviceKeywords: [
        'handyman-at-work,home-repair,professional-service,quality-workmanship',
        'furniture-assembly,ikea-assembly,professional-assembly,organized-work',
        'drywall-repair,wall-repair,painting-repair,professional-fix',
        'fixture-installation,hardware-installation,mounting-service,professional',
        'deck-repair,fence-repair,outdoor-maintenance,wood-repair,professional',
        'home-maintenance,general-contractor,versatile-service,professional-handyman'
      ],
      about: 'handyman-with-tools,tool-belt,service-truck,professional-contractor',
      guidelines: `
**Image Guidelines for Handyman:**
- Hero: Professional handyman at work, quality repairs, modern home
- Service cards: Various repair work, professional tools, quality results
- About: Handyman with full toolbelt, organized truck, professional appearance
- ❌ AVOID: Broken items, messy work areas, unprofessional appearance
- ✅ SHOW: Quality repairs, professional tools, versatile skills, satisfied customers
      `
    };
  }
  
  // ============================================
  // ADDITIONAL POPULAR SERVICE BUSINESSES (11-30)
  // ============================================
  
  // 11. CARPET CLEANING
  if (type.includes('carpet') && !type.includes('install')) {
    return {
      hero: 'clean-carpet,professional-steam-cleaning,spotless-floor,fresh-carpet',
      serviceKeywords: [
        'carpet-cleaning,steam-cleaning,professional-equipment,deep-clean',
        'stain-removal,spot-treatment,professional-cleaning,clean-results',
        'upholstery-cleaning,furniture-cleaning,couch-cleaning,professional',
        'pet-stain-removal,odor-removal,professional-treatment,fresh-clean',
        'commercial-carpet-cleaning,office-carpet,large-scale,professional',
        'tile-cleaning,grout-cleaning,floor-cleaning,professional-service'
      ],
      about: 'carpet-cleaner,cleaning-van,professional-equipment,cleaning-technician',
      guidelines: `
**Image Guidelines for Carpet Cleaning:**
- Hero: Clean, fresh carpet, professional results, modern home
- Service cards: Cleaning in progress, professional equipment, visible results
- About: Technician with equipment, branded van, professional service
- ❌ AVOID: Stained carpets, pet messes, dirty "before" shots
- ✅ SHOW: Clean results, professional equipment, satisfied customers, fresh spaces
      `
    };
  }
  
  // 12. POOL SERVICE & MAINTENANCE
  if (type.includes('pool') && !type.includes('pooling')) {
    return {
      hero: 'crystal-clear-pool,pool-maintenance,beautiful-backyard,clean-water',
      serviceKeywords: [
        'pool-cleaning,pool-maintenance,pool-service,professional-care',
        'pool-repair,equipment-repair,pool-pump,professional-fix',
        'pool-opening,pool-closing,seasonal-service,professional-preparation',
        'pool-renovation,pool-resurfacing,pool-upgrade,modern-pool',
        'hot-tub-service,spa-maintenance,jacuzzi-care,professional-service',
        'commercial-pool,public-pool,pool-facility,professional-maintenance'
      ],
      about: 'pool-technician,cleaning-equipment,service-truck,professional-service',
      guidelines: `
**Image Guidelines for Pool Service:**
- Hero: Crystal clear pool, beautiful backyard, professional maintenance
- Service cards: Technician servicing pool, clean equipment, quality work
- About: Professional with pool equipment, service truck, organized supplies
- ❌ AVOID: Green/dirty pools, algae, broken equipment, neglected pools
- ✅ SHOW: Sparkling pools, professional service, happy pool owners, clean backyards
      `
    };
  }
  
  // 13. WINDOW WASHING
  if (type.includes('window') && (type.includes('wash') || type.includes('clean'))) {
    return {
      hero: 'sparkling-windows,professional-window-cleaning,clear-view,modern-building',
      serviceKeywords: [
        'window-cleaning,glass-cleaning,professional-washer,spotless-windows',
        'high-rise-window-cleaning,commercial-windows,professional-equipment',
        'residential-window-cleaning,home-windows,clean-glass,professional',
        'pressure-washing,exterior-cleaning,building-washing,professional-clean',
        'gutter-cleaning,exterior-maintenance,professional-service,complete-care',
        'solar-panel-cleaning,panel-maintenance,efficiency,professional-service'
      ],
      about: 'window-cleaner,safety-equipment,professional-washer,service-van',
      guidelines: `
**Image Guidelines for Window Washing:**
- Hero: Sparkling clean windows, clear view, professional results
- Service cards: Professional cleaners at work, safety equipment, clean results
- About: Window cleaners with equipment, safety gear, professional service
- ❌ AVOID: Streaky windows, unsafe practices, unprofessional appearance
- ✅ SHOW: Crystal clear results, safety measures, professional equipment, happy clients
      `
    };
  }
  
  // 14. JUNK REMOVAL & HAULING
  if (type.includes('junk') || type.includes('haul') || type.includes('debris')) {
    return {
      hero: 'clean-space,decluttered-home,empty-room,organized-space',
      serviceKeywords: [
        'junk-removal,hauling-service,professional-removal,clean-truck',
        'furniture-removal,appliance-removal,large-item-pickup,professional',
        'estate-cleanout,hoarding-cleanup,complete-removal,compassionate-service',
        'construction-debris,renovation-cleanup,contractor-cleanup,professional',
        'yard-waste-removal,landscaping-debris,green-waste,professional-hauling',
        'donation-pickup,recycling-service,eco-friendly,responsible-disposal'
      ],
      about: 'removal-crew,junk-truck,professional-team,organized-service',
      guidelines: `
**Image Guidelines for Junk Removal:**
- Hero: Clean, empty space, decluttered room, organized environment
- Service cards: Professional crew loading truck, organized removal, clean work
- About: Team with truck, organized operation, professional uniforms
- ❌ AVOID: Messy piles, hoarder situations, overwhelming junk photos
- ✅ SHOW: Clean results, professional crew, organized trucks, satisfied customers
      `
    };
  }
  
  // 15. GARAGE DOOR REPAIR
  if (type.includes('garage door')) {
    return {
      hero: 'modern-garage-door,quality-installation,professional-service,modern-home',
      serviceKeywords: [
        'garage-door-repair,door-installation,professional-service,quality-work',
        'garage-door-opener,automatic-door,smart-garage,modern-technology',
        'spring-replacement,door-maintenance,professional-repair,safety-service',
        'commercial-garage-door,industrial-door,large-scale,professional',
        'garage-door-installation,new-door,modern-design,professional-install',
        'emergency-repair,broken-door,fast-service,24-7-repair'
      ],
      about: 'garage-door-technician,service-van,professional-tools,experienced-tech',
      guidelines: `
**Image Guidelines for Garage Door:**
- Hero: Modern garage door, quality installation, attractive home exterior
- Service cards: Technician repairing/installing, professional tools, quality work
- About: Professional technician with tools, service van, experienced worker
- ❌ AVOID: Broken doors, damaged property, safety hazards
- ✅ SHOW: Quality installations, modern doors, professional service, satisfied homeowners
      `
    };
  }
  
  // 16. LOCKSMITH SERVICES
  if (type.includes('lock')) {
    return {
      hero: 'modern-lock-system,smart-lock,home-security,professional-installation',
      serviceKeywords: [
        'locksmith-at-work,lock-installation,professional-locksmith,expert-service',
        'lock-repair,rekey-service,lock-change,professional-security',
        'smart-lock,keyless-entry,modern-security,technology-upgrade',
        'car-locksmith,automotive-locksmith,key-replacement,mobile-service',
        'commercial-locksmith,business-security,access-control,professional',
        'emergency-locksmith,lockout-service,24-7-service,fast-response'
      ],
      about: 'professional-locksmith,locksmith-tools,service-van,licensed-tech',
      guidelines: `
**Image Guidelines for Locksmith:**
- Hero: Modern lock system, smart technology, home security, professional
- Service cards: Locksmith working on locks, professional tools, quality service
- About: Professional locksmith with tools, service van, trusted technician
- ❌ AVOID: Broken locks, forced entry, security breaches, lockouts
- ✅ SHOW: Modern security, professional installation, quality locks, peace of mind
      `
    };
  }
  
  // 17. PRESSURE WASHING
  if (type.includes('pressure wash') || type.includes('power wash')) {
    return {
      hero: 'clean-driveway,pressure-washing,professional-cleaning,spotless-exterior',
      serviceKeywords: [
        'driveway-cleaning,concrete-cleaning,pressure-washing,professional-clean',
        'house-washing,siding-cleaning,exterior-cleaning,building-wash',
        'deck-cleaning,wood-cleaning,deck-restoration,professional-pressure-wash',
        'commercial-pressure-washing,parking-lot,building-exterior,large-scale',
        'roof-cleaning,moss-removal,soft-wash,professional-service',
        'fence-cleaning,patio-cleaning,outdoor-surfaces,professional-wash'
      ],
      about: 'pressure-washer,professional-equipment,service-truck,cleaning-technician',
      guidelines: `
**Image Guidelines for Pressure Washing:**
- Hero: Dramatic before/after or clean driveway, professional results
- Service cards: Pressure washing in action, visible cleaning, professional equipment
- About: Technician with equipment, professional truck, quality tools
- ❌ AVOID: Only "before" dirty shots, excessive mess, unprofessional
- ✅ SHOW: Clean results, professional equipment, dramatic improvements, satisfied customers
      `
    };
  }
  
  // 18. MOVING SERVICES
  if (type.includes('moving') || type.includes('mover') || type.includes('relocation')) {
    return {
      hero: 'professional-movers,organized-move,moving-truck,efficient-service',
      serviceKeywords: [
        'movers-at-work,careful-handling,professional-movers,organized-team',
        'moving-truck,box-truck,professional-vehicle,clean-truck',
        'packing-service,professional-packing,organized-boxes,careful-wrapping',
        'furniture-moving,heavy-lifting,professional-handling,safe-transport',
        'commercial-moving,office-relocation,business-move,professional-service',
        'long-distance-moving,interstate-moving,cross-country,reliable-service'
      ],
      about: 'moving-crew,professional-movers,moving-truck,organized-team',
      guidelines: `
**Image Guidelines for Moving:**
- Hero: Professional movers at work, organized move, clean truck
- Service cards: Team moving furniture, careful handling, professional service
- About: Professional crew, clean trucks, organized operation
- ❌ AVOID: Damaged furniture, messy moves, unprofessional appearance
- ✅ SHOW: Careful handling, professional crew, organized moves, satisfied customers
      `
    };
  }
  
  // 19. APPLIANCE REPAIR
  if (type.includes('appliance')) {
    return {
      hero: 'appliance-repair,professional-technician,modern-kitchen,quality-service',
      serviceKeywords: [
        'refrigerator-repair,fridge-repair,appliance-fix,professional-service',
        'washer-repair,dryer-repair,laundry-appliance,professional-tech',
        'dishwasher-repair,kitchen-appliance,professional-fix,quality-work',
        'oven-repair,stove-repair,range-repair,professional-service',
        'commercial-appliance,restaurant-equipment,professional-repair,fast-service',
        'appliance-installation,new-appliance,professional-install,quality-setup'
      ],
      about: 'appliance-technician,repair-tools,service-van,professional-tech',
      guidelines: `
**Image Guidelines for Appliance Repair:**
- Hero: Modern kitchen, working appliances, professional service
- Service cards: Technician repairing appliances, professional tools, quality work
- About: Professional technician with tools, service van, experienced worker
- ❌ AVOID: Broken appliances, flooded laundry rooms, messy repairs
- ✅ SHOW: Professional repairs, modern appliances, quality service, satisfied customers
      `
    };
  }
  
  // 20. TREE SERVICE
  if (type.includes('tree') && !type.includes('street')) {
    return {
      hero: 'professional-tree-service,tree-trimming,arborist-work,beautiful-trees',
      serviceKeywords: [
        'tree-removal,tree-cutting,professional-arborist,safe-removal',
        'tree-trimming,tree-pruning,professional-pruning,tree-care',
        'stump-grinding,stump-removal,professional-equipment,clean-removal',
        'tree-health,tree-disease,arborist-inspection,professional-diagnosis',
        'emergency-tree-service,storm-damage,fallen-tree,24-7-service',
        'commercial-tree-service,large-scale,professional-crew,municipal'
      ],
      about: 'arborist-at-work,tree-equipment,professional-crew,safety-gear',
      guidelines: `
**Image Guidelines for Tree Service:**
- Hero: Professional arborist at work, well-maintained trees, safe practices
- Service cards: Tree work in progress, professional equipment, safety measures
- About: Professional crew with equipment, safety gear, experienced arborists
- ❌ AVOID: Fallen trees from storms, dangerous situations, damaged property
- ✅ SHOW: Professional work, safety equipment, beautiful results, healthy trees
      `
    };
  }
  
  // ============================================
  // SPECIALIZED SERVICE BUSINESSES (21-50)
  // ============================================
  
  // 21. SALON & HAIR SERVICES
  if (type.includes('salon') || type.includes('hair') || type.includes('barber')) {
    return {
      hero: 'modern-salon,elegant-interior,professional-stylist,luxury-salon',
      serviceKeywords: [
        'hair-stylist,haircut-service,professional-salon,modern-styling',
        'hair-coloring,balayage,highlights,professional-color,expert-colorist',
        'mens-haircut,barber-service,professional-barber,classic-cut',
        'womens-haircut,hairstyling,professional-cut,salon-service',
        'bridal-hair,wedding-styling,special-occasion,updo-styling',
        'hair-treatment,keratin-treatment,professional-care,salon-treatment'
      ],
      about: 'salon-team,professional-stylists,modern-salon-interior,elegant-space',
      guidelines: `
**Image Guidelines for Salon:**
- Hero: Elegant salon interior, modern equipment, professional atmosphere
- Service cards: Stylists providing services, professional work, happy clients
- About: Professional team, modern salon environment, quality equipment
- ❌ AVOID: Generic model photos, stock beauty shots, unprofessional settings
- ✅ SHOW: Real salon environment, professional services, elegant spaces, satisfied clients
      `
    };
  }
  
  // 22. SPA & MASSAGE THERAPY
  if (type.includes('spa') || type.includes('massage')) {
    return {
      hero: 'luxury-spa,relaxing-environment,spa-treatment,tranquil-space',
      serviceKeywords: [
        'massage-therapy,therapeutic-massage,relaxation,professional-therapist',
        'facial-treatment,skincare,spa-facial,professional-esthetician',
        'spa-treatment,wellness-spa,relaxation-therapy,peaceful-environment',
        'hot-stone-massage,deep-tissue,professional-massage,healing-therapy',
        'couples-massage,romantic-spa,relaxation-together,luxury-treatment',
        'medical-spa,aesthetic-treatments,professional-care,modern-facility'
      ],
      about: 'spa-therapist,massage-room,tranquil-environment,professional-spa',
      guidelines: `
**Image Guidelines for Spa:**
- Hero: Tranquil spa environment, relaxing atmosphere, professional setting
- Service cards: Professional treatments, peaceful environment, quality service
- About: Professional therapists, serene spa spaces, calming atmosphere
- ❌ AVOID: Clinical settings, generic stock photos, unprofessional environments
- ✅ SHOW: Peaceful spaces, professional therapists, relaxing atmosphere, satisfied clients
      `
    };
  }
  
  // 23. NAIL SALON
  if (type.includes('nail') || type.includes('manicure') || type.includes('pedicure')) {
    return {
      hero: 'modern-nail-salon,professional-manicure,elegant-nails,luxury-salon',
      serviceKeywords: [
        'manicure-service,nail-art,professional-nails,beautiful-manicure',
        'pedicure-service,foot-spa,professional-pedicure,relaxing-treatment',
        'gel-nails,acrylic-nails,nail-extensions,professional-application',
        'nail-art,creative-nails,professional-design,artistic-nails',
        'spa-pedicure,luxury-pedicure,foot-massage,relaxing-treatment',
        'bridal-nails,wedding-nails,special-occasion,elegant-design'
      ],
      about: 'nail-technician,modern-salon,professional-service,clean-salon',
      guidelines: `
**Image Guidelines for Nail Salon:**
- Hero: Modern nail salon interior, elegant atmosphere, professional setting
- Service cards: Professional nail services, beautiful results, quality work
- About: Professional technicians, modern salon, clean environment
- ❌ AVOID: Generic hand photos, stock nail images, unprofessional settings
- ✅ SHOW: Professional services, beautiful nail art, elegant salon, satisfied clients
      `
    };
  }
  
  // 24. PERSONAL TRAINING & FITNESS
  if (type.includes('personal train') || type.includes('fitness coach')) {
    return {
      hero: 'personal-trainer,fitness-coaching,workout-session,gym-training',
      serviceKeywords: [
        'personal-training,one-on-one-coaching,fitness-session,professional-trainer',
        'strength-training,weight-lifting,gym-workout,fitness-coaching',
        'cardio-training,endurance-training,fitness-workout,professional-coaching',
        'nutrition-coaching,meal-planning,diet-consultation,health-coaching',
        'group-fitness,fitness-class,group-training,energetic-workout',
        'online-training,virtual-coaching,remote-fitness,digital-training'
      ],
      about: 'fitness-trainer,gym-environment,professional-coach,athletic-trainer',
      guidelines: `
**Image Guidelines for Personal Training:**
- Hero: Professional trainer with client, active workout, motivating environment
- Service cards: Training sessions, various exercises, professional coaching
- About: Professional trainer, gym setting, motivating atmosphere
- ❌ AVOID: Intimidating bodybuilder photos, extreme fitness, inaccessible images
- ✅ SHOW: Supportive coaching, diverse clients, professional guidance, positive environment
      `
    };
  }
  
  // 25. DOG GROOMING & PET SERVICES
  if (type.includes('dog groom') || type.includes('pet groom')) {
    return {
      hero: 'dog-grooming,professional-groomer,happy-dog,clean-pet',
      serviceKeywords: [
        'dog-bath,pet-washing,professional-grooming,clean-dog',
        'dog-haircut,pet-styling,professional-groomer,breed-cut',
        'nail-trimming,paw-care,professional-grooming,pet-care',
        'mobile-grooming,grooming-van,convenient-service,professional-mobile',
        'cat-grooming,feline-grooming,professional-cat-care,gentle-grooming',
        'luxury-pet-spa,premium-grooming,pampered-pet,high-end-service'
      ],
      about: 'pet-groomer,grooming-salon,professional-equipment,animal-care',
      guidelines: `
**Image Guidelines for Pet Grooming:**
- Hero: Happy groomed dog, professional groomer, clean salon
- Service cards: Grooming in progress, various pets, professional care
- About: Professional groomer with pets, clean salon, quality equipment
- ❌ AVOID: Scared animals, messy pets, unprofessional settings, stressed animals
- ✅ SHOW: Happy pets, professional grooming, clean results, caring service
      `
    };
  }
  
  // 26. PHOTOGRAPHY SERVICES
  if (type.includes('photograph') && !type.includes('photo booth')) {
    return {
      hero: 'professional-photographer,photography-session,modern-camera,creative-work',
      serviceKeywords: [
        'wedding-photography,bride-groom,wedding-day,professional-photos',
        'portrait-photography,family-photos,professional-portraits,studio-photography',
        'event-photography,party-photos,celebration,professional-coverage',
        'real-estate-photography,property-photos,architectural,professional-listing',
        'commercial-photography,business-photos,product-photography,professional-commercial',
        'newborn-photography,baby-photos,maternity,professional-baby-photographer'
      ],
      about: 'professional-photographer,camera-equipment,photography-studio,creative-workspace',
      guidelines: `
**Image Guidelines for Photography:**
- Hero: Professional photographer at work, quality camera equipment, creative setting
- Service cards: Various photography types, professional work, beautiful results
- About: Photographer with equipment, professional studio, quality gear
- ❌ AVOID: Generic camera stock photos, amateur work, unprofessional settings
- ✅ SHOW: Professional equipment, creative work, happy clients, beautiful results
      `
    };
  }
  
  // 27. CATERING SERVICES
  if (type.includes('cater') || type.includes('event food')) {
    return {
      hero: 'elegant-catering,food-presentation,professional-service,event-dining',
      serviceKeywords: [
        'wedding-catering,elegant-reception,formal-dining,professional-service',
        'corporate-catering,business-lunch,professional-event,quality-food',
        'buffet-service,food-station,elegant-display,professional-catering',
        'plated-dinner,formal-service,elegant-presentation,professional-waitstaff',
        'outdoor-catering,barbecue-catering,casual-elegant,professional-outdoor',
        'dessert-catering,pastry-service,elegant-sweets,professional-desserts'
      ],
      about: 'catering-team,professional-chef,kitchen-staff,service-team',
      guidelines: `
**Image Guidelines for Catering:**
- Hero: Elegant food presentation, professional service, beautiful event
- Service cards: Various catering styles, food displays, professional service
- About: Professional catering team, kitchen prep, quality presentation
- ❌ AVOID: Messy food, unprofessional presentation, chaotic kitchens
- ✅ SHOW: Elegant presentations, professional service, happy guests, quality food
      `
    };
  }
  
  // 28. EVENT PLANNING
  if (type.includes('event plan') || type.includes('party plan') || type.includes('wedding plan')) {
    return {
      hero: 'elegant-event,wedding-reception,beautiful-venue,professional-planning',
      serviceKeywords: [
        'wedding-planning,bride-planning,wedding-day,professional-coordinator',
        'corporate-event,business-meeting,conference,professional-planning',
        'birthday-party,celebration,party-planning,festive-event',
        'venue-decoration,event-setup,elegant-decor,professional-design',
        'event-coordination,day-of-coordination,professional-planner,organized-event',
        'luxury-event,high-end-planning,elegant-celebration,premium-service'
      ],
      about: 'event-planner,planning-meeting,professional-coordinator,organized-planning',
      guidelines: `
**Image Guidelines for Event Planning:**
- Hero: Beautiful event setup, elegant venue, professional coordination
- Service cards: Various event types, planning process, beautiful results
- About: Professional planner at work, planning materials, organized workspace
- ❌ AVOID: Chaotic events, messy setups, unprofessional environments
- ✅ SHOW: Elegant events, professional planning, happy clients, beautiful details
      `
    };
  }
  
  // 29. TUTORING SERVICES
  if (type.includes('tutor') || type.includes('academic') || type.includes('learning center')) {
    return {
      hero: 'tutoring-session,student-learning,professional-tutor,educational-environment',
      serviceKeywords: [
        'one-on-one-tutoring,private-lesson,focused-learning,professional-tutor',
        'math-tutoring,mathematics,problem-solving,academic-help',
        'reading-tutoring,literacy,reading-skills,educational-support',
        'test-prep,sat-prep,exam-preparation,professional-coaching',
        'online-tutoring,virtual-learning,remote-education,digital-tutoring',
        'homework-help,study-skills,academic-support,learning-assistance'
      ],
      about: 'professional-tutor,learning-space,educational-materials,teaching-environment',
      guidelines: `
**Image Guidelines for Tutoring:**
- Hero: Engaged tutoring session, focused student, professional tutor
- Service cards: Various subjects, learning environments, professional teaching
- About: Professional tutor, organized learning space, educational materials
- ❌ AVOID: Frustrated students, chaotic classrooms, unprofessional settings
- ✅ SHOW: Engaged learning, professional tutors, supportive environment, student success
      `
    };
  }
  
  // 30. HOME INSPECTION
  if (type.includes('home inspect') || type.includes('property inspect')) {
    return {
      hero: 'home-inspector,professional-inspection,quality-assessment,modern-home',
      serviceKeywords: [
        'home-inspection,property-inspection,professional-inspector,thorough-check',
        'roof-inspection,structural-inspection,building-assessment,professional-review',
        'pre-purchase-inspection,home-buying,due-diligence,professional-service',
        'electrical-inspection,safety-check,code-compliance,professional-assessment',
        'termite-inspection,pest-inspection,wood-damage,professional-detection',
        'commercial-inspection,building-inspection,property-assessment,professional-service'
      ],
      about: 'certified-inspector,inspection-tools,professional-equipment,licensed-inspector',
      guidelines: `
**Image Guidelines for Home Inspection:**
- Hero: Professional inspector at work, thorough inspection, modern home
- Service cards: Various inspection types, professional equipment, detailed work
- About: Certified inspector with tools, professional appearance, quality equipment
- ❌ AVOID: Damaged properties, serious defects, alarming issues
- ✅ SHOW: Professional inspection, thorough work, quality equipment, detailed reports
      `
    };
  }
  
  // ============================================
  // MORE SPECIALIZED SERVICES (31-50)
  // ============================================
  
  // 31. FLORIST & FLOWER DELIVERY
  if (type.includes('florist') || type.includes('flower')) {
    return {
      hero: 'beautiful-flowers,floral-arrangement,professional-florist,elegant-bouquet',
      serviceKeywords: [
        'wedding-flowers,bridal-bouquet,wedding-florals,elegant-arrangements',
        'flower-delivery,fresh-flowers,bouquet-delivery,professional-service',
        'funeral-flowers,sympathy-flowers,respectful-arrangements,compassionate-service',
        'corporate-flowers,office-arrangements,business-florals,professional-displays',
        'event-florals,party-flowers,celebration-arrangements,festive-displays',
        'custom-arrangements,unique-designs,artistic-florals,creative-bouquets'
      ],
      about: 'professional-florist,flower-shop,floral-studio,creative-workspace',
      guidelines: `
**Image Guidelines for Florist:**
- Hero: Beautiful floral arrangements, elegant bouquets, professional design
- Service cards: Various flower types, occasions, professional arrangements
- About: Florist at work, flower shop, creative process, quality flowers
- ❌ AVOID: Wilted flowers, generic stock photos, unprofessional arrangements
- ✅ SHOW: Fresh flowers, elegant designs, professional work, satisfied customers
      `
    };
  }
  
  // 32. MOBILE MECHANIC
  if (type.includes('mobile mechanic') || type.includes('mobile auto')) {
    return {
      hero: 'mobile-mechanic,on-site-repair,professional-service,convenient-car-repair',
      serviceKeywords: [
        'mobile-car-repair,on-site-service,driveway-repair,convenient-mechanic',
        'oil-change-service,mobile-maintenance,professional-service,quick-lube',
        'brake-repair,mobile-brake-service,professional-fix,safety-repair',
        'battery-replacement,jump-start,mobile-battery,emergency-service',
        'diagnostic-service,check-engine-light,mobile-diagnostic,professional-scan',
        'fleet-service,commercial-vehicles,business-auto,mobile-maintenance'
      ],
      about: 'mobile-mechanic,service-van,professional-tools,experienced-technician',
      guidelines: `
**Image Guidelines for Mobile Mechanic:**
- Hero: Mechanic at customer location, professional service, convenient repair
- Service cards: Various repairs on-site, professional tools, quality work
- About: Mechanic with fully equipped van, professional tools, mobile service
- ❌ AVOID: Broken-down cars, roadside emergencies, unprofessional appearance
- ✅ SHOW: Convenient service, professional repairs, quality tools, satisfied customers
      `
    };
  }
  
  // 33. SENIOR CARE / HOME HEALTH
  if (type.includes('senior care') || type.includes('home health') || type.includes('elder care')) {
    return {
      hero: 'compassionate-care,senior-assistance,professional-caregiver,home-care',
      serviceKeywords: [
        'elderly-care,senior-assistance,compassionate-caregiver,home-support',
        'home-health-aide,medical-assistance,professional-care,skilled-nursing',
        'companion-care,social-support,friendship,emotional-care',
        'meal-preparation,daily-living,personal-care,professional-assistance',
        'dementia-care,alzheimers-care,specialized-care,professional-support',
        'respite-care,family-relief,temporary-care,professional-support'
      ],
      about: 'professional-caregiver,healthcare-worker,compassionate-professional,certified-aide',
      guidelines: `
**Image Guidelines for Senior Care:**
- Hero: Compassionate caregiver with senior, warm interaction, home environment
- Service cards: Various care activities, professional assistance, warm atmosphere
- About: Professional caregiver, caring demeanor, certified professional
- ❌ AVOID: Clinical hospital settings, impersonal care, sad/lonely images
- ✅ SHOW: Warm interactions, professional care, home comfort, dignity and respect
      `
    };
  }
  
  // 34. DRIVEWAY/CONCRETE SERVICES
  if (type.includes('driveway') || type.includes('concrete') || type.includes('asphalt')) {
    return {
      hero: 'new-driveway,concrete-installation,professional-paving,quality-driveway',
      serviceKeywords: [
        'concrete-driveway,new-installation,professional-pour,quality-concrete',
        'driveway-repair,crack-repair,resurfacing,professional-fix',
        'asphalt-paving,blacktop,professional-paving,smooth-surface',
        'stamped-concrete,decorative-concrete,custom-design,artistic-concrete',
        'concrete-patio,outdoor-living,professional-installation,quality-work',
        'commercial-paving,parking-lot,large-scale,professional-contractor'
      ],
      about: 'concrete-crew,paving-equipment,professional-contractors,work-in-progress',
      guidelines: `
**Image Guidelines for Concrete/Driveway:**
- Hero: Beautiful new driveway, professional installation, quality work
- Service cards: Installation process, professional equipment, quality results
- About: Professional crew, commercial equipment, organized operation
- ❌ AVOID: Cracked driveways, poor work, unprofessional results
- ✅ SHOW: Quality installations, professional crew, beautiful results, satisfied homeowners
      `
    };
  }
  
  // 35. CHIMNEY SWEEP / FIREPLACE
  if (type.includes('chimney') || type.includes('fireplace')) {
    return {
      hero: 'clean-chimney,fireplace-maintenance,professional-sweep,home-safety',
      serviceKeywords: [
        'chimney-sweep,chimney-cleaning,professional-service,safety-inspection',
        'fireplace-repair,chimney-repair,professional-fix,quality-masonry',
        'chimney-inspection,safety-check,professional-assessment,thorough-inspection',
        'chimney-cap,rain-cap,professional-installation,weather-protection',
        'wood-stove-service,stove-installation,professional-setup,efficient-heating',
        'creosote-removal,chimney-maintenance,fire-safety,professional-cleaning'
      ],
      about: 'chimney-sweep,professional-equipment,safety-gear,certified-sweep',
      guidelines: `
**Image Guidelines for Chimney Services:**
- Hero: Professional chimney sweep, clean fireplace, home safety
- Service cards: Cleaning process, inspection work, professional equipment
- About: Certified sweep with equipment, professional appearance, safety focus
- ❌ AVOID: Dirty chimneys, fire hazards, unsafe conditions
- ✅ SHOW: Professional service, clean results, safety focus, satisfied homeowners
      `
    };
  }
  
  // 36. GUTTER INSTALLATION/REPAIR
  if (type.includes('gutter') && !type.includes('clean')) {
    return {
      hero: 'gutter-installation,seamless-gutters,professional-install,quality-gutters',
      serviceKeywords: [
        'gutter-installation,new-gutters,professional-install,seamless-gutters',
        'gutter-repair,leak-repair,professional-fix,quality-repair',
        'gutter-guards,leaf-protection,gutter-covers,professional-installation',
        'downspout-installation,drainage-system,professional-setup,proper-drainage',
        'commercial-gutters,large-building,professional-contractor,industrial-gutters',
        'copper-gutters,luxury-gutters,custom-installation,high-end-material'
      ],
      about: 'gutter-installer,professional-crew,work-truck,installation-equipment',
      guidelines: `
**Image Guidelines for Gutters:**
- Hero: New gutter installation, professional work, quality materials
- Service cards: Installation process, repair work, professional crew
- About: Professional installers, equipment, organized operation
- ❌ AVOID: Clogged gutters, water damage, poor installations
- ✅ SHOW: Quality installations, professional work, proper drainage, satisfied homeowners
      `
    };
  }
  
  // 37. SIDING INSTALLATION/REPAIR
  if (type.includes('siding')) {
    return {
      hero: 'new-siding,home-exterior,professional-installation,beautiful-home',
      serviceKeywords: [
        'vinyl-siding,siding-installation,professional-contractor,quality-install',
        'siding-repair,exterior-repair,professional-fix,matching-repair',
        'fiber-cement,hardie-board,durable-siding,professional-installation',
        'wood-siding,cedar-siding,natural-material,professional-install',
        'siding-replacement,home-renovation,exterior-upgrade,professional-contractor',
        'commercial-siding,building-exterior,large-scale,professional-installation'
      ],
      about: 'siding-crew,professional-contractors,installation-equipment,work-truck',
      guidelines: `
**Image Guidelines for Siding:**
- Hero: Beautiful home with new siding, professional installation, quality work
- Service cards: Installation process, various materials, professional work
- About: Professional crew, equipment, organized operation
- ❌ AVOID: Damaged siding, poor installations, unprofessional work
- ✅ SHOW: Quality installations, beautiful homes, professional crew, satisfied homeowners
      `
    };
  }
  
  // 38. TILE & FLOORING INSTALLATION
  if (type.includes('tile') || type.includes('flooring')) {
    return {
      hero: 'tile-installation,beautiful-flooring,professional-work,modern-floor',
      serviceKeywords: [
        'tile-installation,ceramic-tile,professional-installer,quality-work',
        'hardwood-flooring,wood-floor,professional-installation,beautiful-wood',
        'laminate-flooring,modern-flooring,professional-install,durable-floor',
        'vinyl-plank,luxury-vinyl,waterproof-flooring,professional-installation',
        'bathroom-tile,kitchen-backsplash,tile-work,professional-design',
        'commercial-flooring,large-scale,professional-contractor,industrial-floor'
      ],
      about: 'flooring-installer,tile-setter,professional-tools,skilled-craftsman',
      guidelines: `
**Image Guidelines for Tile/Flooring:**
- Hero: Beautiful new floor, professional installation, modern design
- Service cards: Installation process, various materials, professional craftsmanship
- About: Professional installer with tools, skilled work, quality materials
- ❌ AVOID: Cracked tiles, poor installations, messy work sites
- ✅ SHOW: Beautiful results, professional installation, quality craftsmanship, satisfied customers
      `
    };
  }
  
  // 39. KITCHEN & BATH REMODELING
  if (type.includes('remodel') || type.includes('renovation')) {
    return {
      hero: 'modern-kitchen,beautiful-remodel,professional-renovation,luxury-upgrade',
      serviceKeywords: [
        'kitchen-remodel,modern-kitchen,professional-renovation,beautiful-upgrade',
        'bathroom-remodel,luxury-bathroom,spa-bathroom,professional-renovation',
        'cabinet-installation,custom-cabinets,professional-install,quality-cabinetry',
        'countertop-installation,granite-countertops,quartz,professional-fabrication',
        'complete-remodel,full-renovation,transformation,professional-contractor',
        'commercial-renovation,restaurant-remodel,business-upgrade,professional-commercial'
      ],
      about: 'remodeling-contractor,construction-crew,professional-renovation,quality-work',
      guidelines: `
**Image Guidelines for Remodeling:**
- Hero: Beautiful modern kitchen or bathroom, professional renovation, luxury upgrade
- Service cards: Before/after, construction process, professional work
- About: Professional contractor, skilled crew, quality craftsmanship
- ❌ AVOID: Construction mess only, demolition without context, poor results
- ✅ SHOW: Beautiful results, professional work, transformations, satisfied homeowners
      `
    };
  }
  
  // 40. BASEMENT FINISHING
  if (type.includes('basement')) {
    return {
      hero: 'finished-basement,modern-space,professional-finish,livable-basement',
      serviceKeywords: [
        'basement-finishing,basement-remodel,additional-living-space,professional-contractor',
        'basement-waterproofing,moisture-control,dry-basement,professional-solution',
        'egress-window,basement-safety,code-compliance,professional-installation',
        'basement-renovation,modernization,upgrade,professional-transformation',
        'home-theater,basement-entertainment,media-room,professional-design',
        'basement-apartment,rental-unit,income-property,professional-conversion'
      ],
      about: 'basement-contractor,construction-crew,professional-finisher,skilled-team',
      guidelines: `
**Image Guidelines for Basement:**
- Hero: Beautiful finished basement, modern living space, professional work
- Service cards: Transformation process, various uses, professional finishing
- About: Professional contractor, skilled crew, quality craftsmanship
- ❌ AVOID: Unfinished basements only, water damage, dark dungeons
- ✅ SHOW: Beautiful finished spaces, professional work, livable areas, increased value
      `
    };
  }
  
  // 41. INSULATION SERVICES
  if (type.includes('insulation')) {
    return {
      hero: 'insulation-installation,energy-efficiency,professional-installer,home-comfort',
      serviceKeywords: [
        'spray-foam-insulation,foam-installation,professional-application,energy-savings',
        'attic-insulation,blown-in-insulation,professional-install,thermal-barrier',
        'wall-insulation,cavity-insulation,professional-installation,energy-efficient',
        'crawlspace-insulation,moisture-barrier,professional-service,home-protection',
        'soundproofing,noise-reduction,acoustic-insulation,professional-installation',
        'commercial-insulation,large-scale,industrial-insulation,professional-contractor'
      ],
      about: 'insulation-crew,spray-equipment,professional-installer,protective-gear',
      guidelines: `
**Image Guidelines for Insulation:**
- Hero: Professional insulation installation, energy efficiency, modern home
- Service cards: Installation process, various types, professional application
- About: Professional crew with equipment, safety gear, organized operation
- ❌ AVOID: Messy installations, poor quality, unprofessional work
- ✅ SHOW: Professional installation, quality materials, energy savings, satisfied homeowners
      `
    };
  }
  
  // 42. FENCING INSTALLATION
  if (type.includes('fence') || type.includes('fencing')) {
    return {
      hero: 'new-fence,fence-installation,professional-fencing,beautiful-backyard',
      serviceKeywords: [
        'wood-fence,privacy-fence,professional-installation,quality-fencing',
        'vinyl-fence,pvc-fence,low-maintenance,professional-install',
        'chain-link-fence,security-fence,professional-installation,durable-fencing',
        'aluminum-fence,decorative-fence,elegant-fencing,professional-install',
        'fence-repair,post-replacement,professional-fix,quality-repair',
        'commercial-fencing,security-fencing,industrial-fence,professional-contractor'
      ],
      about: 'fencing-crew,professional-installers,fence-equipment,work-truck',
      guidelines: `
**Image Guidelines for Fencing:**
- Hero: Beautiful new fence, professional installation, enhanced property
- Service cards: Installation process, various materials, professional work
- About: Professional crew, equipment, organized operation
- ❌ AVOID: Broken fences, poor installations, unprofessional work
- ✅ SHOW: Quality installations, beautiful results, professional crew, satisfied homeowners
      `
    };
  }
  
  // 43. WEDDING SERVICES (DJ/ENTERTAINMENT)
  if (type.includes('wedding dj') || type.includes('dj service') || type.includes('wedding entertainment')) {
    return {
      hero: 'wedding-dj,reception-entertainment,dance-floor,professional-dj',
      serviceKeywords: [
        'wedding-dj,reception-music,professional-entertainment,dance-party',
        'dj-equipment,sound-system,lighting-setup,professional-setup',
        'ceremony-music,cocktail-hour,professional-sound,elegant-music',
        'dance-floor,party-atmosphere,celebration,energetic-entertainment',
        'mc-services,professional-announcer,event-hosting,smooth-transitions',
        'photo-booth,wedding-entertainment,guest-photos,fun-memories'
      ],
      about: 'professional-dj,entertainment-equipment,experienced-entertainer,event-professional',
      guidelines: `
**Image Guidelines for Wedding DJ:**
- Hero: DJ at wedding reception, dance floor, happy celebration
- Service cards: Equipment setup, various events, professional entertainment
- About: Professional DJ with equipment, experienced entertainer, quality gear
- ❌ AVOID: Generic party photos, unprofessional setups, chaotic scenes
- ✅ SHOW: Professional equipment, happy celebrations, dance floors, satisfied clients
      `
    };
  }
  
  // 44. MAKEUP ARTIST
  if (type.includes('makeup') || type.includes('cosmetic')) {
    return {
      hero: 'professional-makeup,bridal-beauty,makeup-artist,elegant-makeup',
      serviceKeywords: [
        'bridal-makeup,wedding-beauty,professional-artist,elegant-bride',
        'special-occasion,event-makeup,professional-application,glamorous-look',
        'airbrush-makeup,flawless-finish,professional-technique,long-lasting',
        'makeup-lesson,beauty-tutorial,professional-teaching,skill-building',
        'commercial-makeup,photo-shoot,editorial-makeup,professional-artist',
        'natural-makeup,everyday-beauty,subtle-enhancement,professional-application'
      ],
      about: 'makeup-artist,beauty-professional,makeup-kit,professional-studio',
      guidelines: `
**Image Guidelines for Makeup Artist:**
- Hero: Professional makeup application, elegant results, skilled artist
- Service cards: Various makeup styles, application process, beautiful results
- About: Professional artist with kit, studio setup, quality products
- ❌ AVOID: Overly dramatic makeup, unnatural results, unprofessional work
- ✅ SHOW: Beautiful natural looks, professional application, happy clients, elegant results
      `
    };
  }
  
  // 45. BOAT/MARINE SERVICES
  if (type.includes('boat') || type.includes('marine')) {
    return {
      hero: 'boat-maintenance,marine-service,professional-care,watercraft',
      serviceKeywords: [
        'boat-detailing,marine-cleaning,yacht-service,professional-care',
        'boat-repair,marine-mechanic,engine-service,professional-fix',
        'winterization,boat-storage,seasonal-service,professional-preparation',
        'fiberglass-repair,hull-repair,professional-restoration,quality-fix',
        'marine-electronics,fish-finder,professional-installation,nautical-tech',
        'yacht-maintenance,luxury-boat,premium-service,professional-care'
      ],
      about: 'marine-technician,boat-mechanic,professional-service,experienced-tech',
      guidelines: `
**Image Guidelines for Marine Services:**
- Hero: Professional boat service, clean watercraft, marina setting
- Service cards: Various services, professional work, marine environment
- About: Marine technician with tools, professional equipment, experienced worker
- ❌ AVOID: Damaged boats, neglected vessels, unprofessional work
- ✅ SHOW: Professional service, clean boats, quality work, satisfied boat owners
      `
    };
  }
  
  // 46. RV/MOBILE HOME SERVICES
  if (type.includes('rv ') || type.includes('motorhome') || type.includes('mobile home')) {
    return {
      hero: 'rv-service,motorhome-maintenance,professional-care,recreational-vehicle',
      serviceKeywords: [
        'rv-repair,motorhome-service,professional-fix,mobile-mechanic',
        'rv-detailing,mobile-home-cleaning,professional-care,quality-service',
        'rv-inspection,pre-purchase,professional-assessment,thorough-check',
        'mobile-home-repair,manufactured-home,professional-service,quality-fix',
        'rv-storage,covered-storage,professional-facility,secure-storage',
        'awning-repair,slide-out-service,rv-maintenance,professional-care'
      ],
      about: 'rv-technician,mobile-service,professional-equipment,experienced-tech',
      guidelines: `
**Image Guidelines for RV Services:**
- Hero: Professional RV service, well-maintained vehicle, professional care
- Service cards: Various services, professional work, quality repairs
- About: RV technician with equipment, professional service, experienced worker
- ❌ AVOID: Neglected RVs, major damage, unprofessional settings
- ✅ SHOW: Professional service, quality work, well-maintained vehicles, satisfied owners
      `
    };
  }
  
  // 47. WEDDING OFFICIANTS
  if (type.includes('officiant') || type.includes('celebrant')) {
    return {
      hero: 'wedding-ceremony,professional-officiant,elegant-wedding,meaningful-ceremony',
      serviceKeywords: [
        'wedding-officiant,ceremony-leader,professional-celebrant,marriage-ceremony',
        'outdoor-ceremony,beach-wedding,garden-ceremony,beautiful-setting',
        'vow-renewal,anniversary-ceremony,professional-officiant,special-celebration',
        'interfaith-ceremony,multicultural-wedding,inclusive-ceremony,professional-service',
        'elopement,intimate-ceremony,small-wedding,professional-officiant',
        'lgbtq-wedding,same-sex-ceremony,inclusive-officiant,professional-celebrant'
      ],
      about: 'wedding-officiant,professional-celebrant,experienced-minister,ceremony-professional',
      guidelines: `
**Image Guidelines for Wedding Officiants:**
- Hero: Beautiful wedding ceremony, professional officiant, meaningful moment
- Service cards: Various ceremony types, different settings, professional service
- About: Professional officiant, welcoming demeanor, experienced celebrant
- ❌ AVOID: Generic wedding stock photos, impersonal ceremonies, religious-only imagery
- ✅ SHOW: Meaningful ceremonies, diverse couples, professional service, happy celebrations
      `
    };
  }
  
  // 48. VOICE LESSONS / MUSIC INSTRUCTION
  if (type.includes('voice lesson') || type.includes('singing lesson') || type.includes('music lesson')) {
    return {
      hero: 'voice-lesson,singing-instruction,professional-teacher,music-education',
      serviceKeywords: [
        'vocal-training,singing-lessons,professional-instruction,voice-development',
        'piano-lessons,keyboard-instruction,professional-teacher,music-education',
        'guitar-lessons,acoustic-guitar,professional-instruction,music-learning',
        'online-lessons,virtual-instruction,remote-learning,digital-music-lessons',
        'group-lessons,ensemble-training,music-class,collaborative-learning',
        'performance-coaching,stage-presence,professional-guidance,confidence-building'
      ],
      about: 'music-teacher,professional-instructor,music-studio,teaching-space',
      guidelines: `
**Image Guidelines for Music Lessons:**
- Hero: Professional music instruction, engaged student, teaching environment
- Service cards: Various instruments, lesson types, professional instruction
- About: Professional instructor, music studio, quality instruments
- ❌ AVOID: Generic music stock photos, concert performances, unprofessional settings
- ✅ SHOW: Engaged learning, professional instruction, supportive environment, student progress
      `
    };
  }
  
  // 49. COMPUTER REPAIR / IT SERVICES
  if (type.includes('computer repair') || type.includes('it service') || type.includes('tech support')) {
    return {
      hero: 'computer-repair,it-service,professional-technician,tech-support',
      serviceKeywords: [
        'laptop-repair,computer-fix,professional-service,tech-repair',
        'virus-removal,malware-cleanup,cybersecurity,professional-protection',
        'data-recovery,backup-service,professional-recovery,data-protection',
        'network-setup,wifi-installation,professional-networking,connectivity',
        'business-it,managed-services,professional-support,enterprise-it',
        'mobile-tech-support,on-site-service,convenient-repair,professional-help'
      ],
      about: 'it-technician,computer-repair,professional-equipment,tech-support',
      guidelines: `
**Image Guidelines for Computer Repair:**
- Hero: Professional technician repairing computer, modern workspace, tech support
- Service cards: Various services, professional work, modern equipment
- About: IT professional with equipment, clean workspace, professional tools
- ❌ AVOID: Broken computers only, frustrated users, messy work areas
- ✅ SHOW: Professional service, modern equipment, happy clients, quality repairs
      `
    };
  }
  
  // 50. MOBILE TIRE SERVICES
  if (type.includes('mobile tire') || type.includes('tire service')) {
    return {
      hero: 'mobile-tire-service,on-site-installation,professional-tire-tech,convenient-service',
      serviceKeywords: [
        'tire-installation,tire-change,professional-service,mobile-convenience',
        'flat-tire-repair,roadside-tire,emergency-service,quick-fix',
        'tire-rotation,tire-maintenance,professional-care,extended-life',
        'wheel-alignment,balance-service,professional-alignment,smooth-ride',
        'commercial-tires,fleet-service,business-tires,professional-commercial',
        'seasonal-tires,winter-tires,summer-tires,tire-changeover,professional-service'
      ],
      about: 'tire-technician,mobile-service,professional-equipment,service-van',
      guidelines: `
**Image Guidelines for Mobile Tire:**
- Hero: Professional tire service at customer location, convenient service, quality work
- Service cards: Installation process, various services, professional equipment
- About: Tire technician with mobile van, professional tools, organized service
- ❌ AVOID: Flat tires only, roadside emergencies, damaged vehicles
- ✅ SHOW: Professional service, quality tires, convenient mobile service, satisfied customers
      `
    };
  }
  
  // ============================================
  // DEFAULT FALLBACK (If no specific match)
  // ============================================
  
  return {
    hero: `professional-${type.replace(/\s+/g, '-')},quality-service,modern-business,expert-service`,
    serviceKeywords: [
      `${type}-service,professional-work,quality-service,expert-care`,
      `${type}-professional,skilled-work,experienced-service,quality-results`,
      `${type}-equipment,professional-tools,modern-equipment,quality-gear`,
      `${type}-customer,satisfied-client,professional-service,happy-customer`
    ],
    about: `${type}-professional,service-team,professional-equipment,experienced-team`,
    guidelines: `
**Image Guidelines for ${businessType}:**
- Hero: Professional ${businessType} service, quality work, modern business
- Service cards: Specific ${businessType} services, professional work, quality results
- About: Professional team with equipment, experienced workers, organized operation
- ❌ AVOID: Generic stock photos, unprofessional settings, unrelated imagery
- ✅ SHOW: Professional service, quality work, satisfied customers, modern equipment
    `
  };
}

module.exports = { getImageGuidance };
