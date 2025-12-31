import React, { useState } from 'react';
import { Wand2, ArrowLeft, Upload, X } from 'lucide-react';
import PricingPage from './PricingPage';
import AIWebsiteEditor from './AIWebsiteEditor';

const AIWebsiteBuilder = () => {
  const [currentView, setCurrentView] = useState('builder'); // 'builder', 'preview', 'pricing'
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [services, setServices] = useState('');
  const [colorScheme, setColorScheme] = useState('blue');
  const [designStyle, setDesignStyle] = useState('professional'); // Default to professional for service businesses
  const [description, setDescription] = useState('');
  const [uploadedImages, setUploadedImages] = useState([]);
  const [generatedHTML, setGeneratedHTML] = useState('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationProgress, setGenerationProgress] = useState(0);
  const [generationStep, setGenerationStep] = useState('');
  const [showEditor, setShowEditor] = useState(false);

  const colorSchemes = {
    blue: { name: 'Ocean Blue', from: 'from-blue-600', to: 'to-cyan-600', accent: 'bg-blue-600' },
    purple: { name: 'Royal Purple', from: 'from-purple-600', to: 'to-pink-600', accent: 'bg-purple-600' },
    green: { name: 'Forest Green', from: 'from-green-600', to: 'to-emerald-600', accent: 'bg-green-600' },
    orange: { name: 'Sunset Orange', from: 'from-orange-600', to: 'to-amber-600', accent: 'bg-orange-600' },
    red: { name: 'Bold Red', from: 'from-red-600', to: 'to-rose-600', accent: 'bg-red-600' },
    slate: { name: 'Professional Gray', from: 'from-slate-700', to: 'to-gray-800', accent: 'bg-slate-700' }
  };

  const handleImageUpload = (e) => {
    const files = Array.from(e.target.files);
    files.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        setUploadedImages(prev => [...prev, { url: e.target.result, name: file.name }]);
      };
      reader.readAsDataURL(file);
    });
  };

  const removeImage = (index) => {
    setUploadedImages(prev => prev.filter((_, i) => i !== index));
  };

  const generateWebsite = async () => {
    if (!businessName.trim() || !businessType.trim()) {
      alert('Please fill in at least Business Name and Type');
      return;
    }
    
    setIsGenerating(true);
    setGenerationProgress(0);
    setGenerationStep('Initializing AI...');

    const prompt = `Create a professional website for a SERVICE BUSINESS:

Business Name: ${businessName}
Business Type: ${businessType}
${address ? `Address: ${address}` : ''}
${phone ? `Phone: ${phone}` : ''}
${services ? `Services Offered: ${services}` : ''}
Color Scheme: ${colorSchemes[colorScheme].name}
Additional Details: ${description || 'Modern, professional service business design'}

Requirements:
- Focus on SERVICE BUSINESS features (booking, consultations, appointments)
- Use ${colorSchemes[colorScheme].name} color scheme (${colorSchemes[colorScheme].from} ${colorSchemes[colorScheme].to})
- Include: Hero section with service value proposition, About/Why Choose Us, Services section with clear descriptions, Testimonials, Contact/Booking form, Footer with business hours
- Make it fully responsive and mobile-friendly
- Add smooth animations and professional transitions
- Include high-quality placeholder images from Unsplash related to the service industry
- Add trust-building elements (credentials, certifications, years of experience)
- Include clear call-to-actions (Book Now, Get Quote, Contact Us)
- Ensure professional ${designStyle} design
${uploadedImages.length > 0 ? `- Incorporate ${uploadedImages.length} uploaded business image(s)` : ''}

CRITICAL - ADVANCED FEATURES TO INCLUDE:

1. AI CHAT WIDGET (Bottom Right Corner):
   - Create a floating chat button (60px circle, purple gradient background, white message icon)
   - Button should pulse/animate to attract attention
   - Clicking opens a chat panel (350px wide, 500px tall, bottom-right, rounded corners)
   - Chat panel has header "💬 Chat with us!", messages area, and input field
   - Include initial AI greeting: "👋 Hi! I'm here to help you learn more about ${businessName}. What can I help you with today?"
   - Style the chat beautifully with gradients and smooth animations
   - Make it fully functional with a send button
   - Add typing indicator animation
   - Mobile responsive (full width on mobile)

2. ONLINE BOOKING SYSTEM:
   - Create a dedicated "Book Appointment" section with id="booking-section"
   - Include a professional booking form with these fields:
     * Full Name (required)
     * Email (required)
     * Phone Number (required)
     * Service dropdown (Consultation, Service Appointment, Follow-up, Other)
     * Date picker (required, minimum date = today)
     * Time slot selection grid (9 AM - 5 PM slots, clickable buttons)
     * Additional notes textarea
   - Style time slots as clickable cards that highlight when selected
   - Include "Confirm Booking" button with gradient purple background
   - Show success message after booking with checkmark icon
   - Make form fully responsive and beautiful
   - Add form validation

3. INTEGRATION CODE:
   At the very end of the HTML, before </body>, add these script tags:

   <script>
   // Chat functionality
   (function() {
     const chatButton = document.querySelector('#ai-chat-button');
     const chatBox = document.querySelector('#ai-chat-box');
     const chatClose = document.querySelector('#ai-chat-close');
     const chatSend = document.querySelector('#ai-chat-send');
     const chatInput = document.querySelector('#ai-chat-input');
     const chatMessages = document.querySelector('#ai-chat-messages');

     if (chatButton) {
       chatButton.addEventListener('click', () => {
         chatBox.style.display = 'flex';
       });
     }

     if (chatClose) {
       chatClose.addEventListener('click', () => {
         chatBox.style.display = 'none';
       });
     }

     function addMessage(text, isUser) {
       const messageDiv = document.createElement('div');
       messageDiv.className = 'chat-message ' + (isUser ? 'user' : 'bot');
       messageDiv.innerHTML = '<div class="message-content">' + text + '</div>';
       chatMessages.appendChild(messageDiv);
       chatMessages.scrollTop = chatMessages.scrollHeight;
     }

     if (chatSend) {
       chatSend.addEventListener('click', () => {
         const message = chatInput.value.trim();
         if (message) {
           addMessage(message, true);
           chatInput.value = '';
           
           // Simulate AI response
           setTimeout(() => {
             const responses = [
               "Thanks for your message! I'd be happy to help you learn more about our services. What specifically interests you?",
               "Great question! Let me help you with that. You can call us at ${phone || '(555) 123-4567'} or book an appointment using the form below.",
               "I'm here to help! Feel free to ask about our services, pricing, or availability. Would you like to schedule a consultation?",
               "Thank you for reaching out! Our team specializes in ${services || 'professional services'}. How can we assist you today?"
             ];
             addMessage(responses[Math.floor(Math.random() * responses.length)], false);
           }, 1000);
         }
       });
     }

     if (chatInput) {
       chatInput.addEventListener('keypress', (e) => {
         if (e.key === 'Enter' && !e.shiftKey) {
           e.preventDefault();
           chatSend.click();
         }
       });
     }
   })();

   // Booking functionality
   (function() {
     const bookingForm = document.querySelector('#booking-form');
     const timeSlots = document.querySelectorAll('.time-slot');
     let selectedTime = null;

     if (timeSlots) {
       timeSlots.forEach(slot => {
         slot.addEventListener('click', () => {
           timeSlots.forEach(s => s.classList.remove('selected'));
           slot.classList.add('selected');
           selectedTime = slot.dataset.time;
         });
       });
     }

     if (bookingForm) {
       bookingForm.addEventListener('submit', (e) => {
         e.preventDefault();
         
         if (!selectedTime) {
           alert('Please select a time slot');
           return;
         }

         const formData = {
           name: document.querySelector('#booking-name').value,
           email: document.querySelector('#booking-email').value,
           phone: document.querySelector('#booking-phone').value,
           service: document.querySelector('#booking-service').value,
           date: document.querySelector('#booking-date').value,
           time: selectedTime,
           notes: document.querySelector('#booking-notes').value
         };

         // Show success message
         document.querySelector('#booking-form-container').style.display = 'none';
         document.querySelector('#booking-success').style.display = 'block';
         
         // Populate success details
         document.querySelector('#success-name').textContent = formData.name;
         document.querySelector('#success-email').textContent = formData.email;
         document.querySelector('#success-date').textContent = new Date(formData.date).toLocaleDateString('en-US', { 
           weekday: 'long', 
           year: 'numeric', 
           month: 'long', 
           day: 'numeric' 
         });
         document.querySelector('#success-time').textContent = formatTime(formData.time);

         console.log('Booking submitted:', formData);
       });
     }

     function formatTime(time) {
       const [hours, minutes] = time.split(':');
       const hour = parseInt(hours);
       const ampm = hour >= 12 ? 'PM' : 'AM';
       const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
       return displayHour + ':' + minutes + ' ' + ampm;
     }

     // Set minimum date to today
     const dateInput = document.querySelector('#booking-date');
     if (dateInput) {
       const today = new Date().toISOString().split('T')[0];
       dateInput.min = today;
       dateInput.value = today;
     }
   })();
   </script>

Generate ONLY the complete HTML code with all CSS and JavaScript inline. Make it production-ready and beautiful!`;

    try {
      setGenerationProgress(10);
      setGenerationStep('Building your website...');

      await new Promise(resolve => setTimeout(resolve, 800));
      setGenerationProgress(20);
      setGenerationStep('Designing your layout...');

      const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001';
      
      const response = await fetch(`${API_URL}/api/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          prompt,
          style: designStyle
        }),
      });

      setGenerationProgress(40);
      setGenerationStep('Adding colors and transitions...');

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate website');
      }

      const data = await response.json();
      
      setGenerationProgress(70);
      setGenerationStep('Perfecting the details...');

      await new Promise(resolve => setTimeout(resolve, 600));
      setGenerationProgress(85);
      setGenerationStep('Almost ready...');

      let htmlContent = data.html;
      
      if (htmlContent.includes('```html')) {
        htmlContent = htmlContent.split('```html')[1].split('```')[0].trim();
      } else if (htmlContent.includes('```')) {
        htmlContent = htmlContent.split('```')[1].split('```')[0].trim();
      }

      setGenerationProgress(100);
      setGenerationStep('Complete!');
      setGeneratedHTML(htmlContent);
      
      setTimeout(() => {
        setCurrentView('preview');
        setIsGenerating(false);
      }, 500);

    } catch (error) {
      console.error('Generation error:', error);
      alert(`Failed to generate website: ${error.message}`);
      setIsGenerating(false);
    }
  };

  const downloadHTML = () => {
    const blob = new Blob([generatedHTML], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${businessName.replace(/\s+/g, '-').toLowerCase()}-website.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(generatedHTML);
    alert('HTML copied to clipboard!');
  };

  const startOver = () => {
    setCurrentView('builder');
    setGeneratedHTML('');
    setBusinessName('');
    setBusinessType('');
    setAddress('');
    setPhone('');
    setServices('');
    setDescription('');
    setUploadedImages([]);
    setDesignStyle('professional');
  };

  // Pricing Page View
  if (currentView === 'pricing') {
    return <PricingPage onBack={() => setCurrentView('preview')} />;
  }

  if (currentView === 'preview') {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col">
        <div className="bg-white shadow-sm border-b sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <button
              onClick={() => setCurrentView('builder')}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
            >
              <ArrowLeft className="w-5 h-5" />
              <span>Back to Editor</span>
            </button>
            <div className="flex gap-3">
              <button
                onClick={() => setShowEditor(!showEditor)}
                className={`px-6 py-2 rounded-lg transition font-semibold ${
                  showEditor 
                    ? 'bg-purple-600 text-white hover:bg-purple-700' 
                    : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                }`}
              >
                {showEditor ? 'Hide' : 'Edit with AI'}
              </button>
              <button
                onClick={() => setCurrentView('pricing')}
                className="px-6 py-2 bg-gradient-to-r from-green-600 to-emerald-600 text-white rounded-lg hover:from-green-700 hover:to-emerald-700 transition shadow-lg font-semibold"
              >
                Launch My Website
              </button>
              <button
                onClick={startOver}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition"
              >
                Start Over
              </button>
            </div>
          </div>
        </div>
        
        <div className="flex-1 flex overflow-hidden">
          {/* AI Editor Panel */}
          {showEditor && (
            <div className="w-96 border-r bg-white p-4 overflow-y-auto">
              <AIWebsiteEditor 
                currentHTML={generatedHTML}
                onHTMLUpdate={setGeneratedHTML}
                businessInfo={{
                  businessName,
                  businessType,
                  phone,
                  address
                }}
              />
            </div>
          )}
          
          {/* Website Preview */}
          <div className="flex-1">
            <iframe
              srcDoc={generatedHTML}
              className="w-full h-full"
              title="Generated Website Preview"
            />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 py-12 px-4">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 bg-white px-4 py-2 rounded-full shadow-sm mb-4">
            <Wand2 className="w-5 h-5 text-purple-600" />
            <span className="text-sm font-medium text-gray-700">AI-Powered</span>
          </div>
          <h1 className="text-5xl font-bold text-gray-900 mb-4">
            High Converting Website Builder
          </h1>
          <p className="text-xl text-gray-600">
            For Service-Based Businesses
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8 space-y-8">
          {/* Instruction Note */}
          <div className="bg-blue-50 border-l-4 border-blue-600 p-4 rounded-r-lg">
            <p className="text-blue-900 font-semibold flex items-center gap-2">
              <Wand2 className="w-5 h-5" />
              Use as much detail as possible!
            </p>
            <p className="text-blue-700 text-sm mt-1">
              The more information you provide, the better your AI-generated website will be.
            </p>
          </div>

          {/* Business Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Business Name *
            </label>
            <input
              type="text"
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="e.g., Acme Corporation"
            />
          </div>

          {/* Business Type */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Business Type *
            </label>
            <input
              type="text"
              value={businessType}
              onChange={(e) => setBusinessType(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="e.g., Restaurant, E-commerce Store, Consulting Agency"
            />
          </div>

          {/* Address */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Address (Optional)
            </label>
            <input
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="123 Main St, City, State 12345"
            />
          </div>

          {/* Phone */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Phone Number (Optional)
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              placeholder="(555) 123-4567"
            />
          </div>

          {/* Services */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Services/Products (Optional)
            </label>
            <textarea
              value={services}
              onChange={(e) => setServices(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              rows="3"
              placeholder="Describe your main services or products..."
            />
          </div>

          {/* Color Scheme */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-3">
              Color Scheme
            </label>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {Object.entries(colorSchemes).map(([key, scheme]) => (
                <button
                  key={key}
                  onClick={() => setColorScheme(key)}
                  className={`p-3 rounded-lg border-2 transition ${
                    colorScheme === key ? 'border-purple-500 shadow-md' : 'border-gray-200 hover:border-purple-300'
                  }`}
                >
                  <div className={`h-8 rounded bg-gradient-to-r ${scheme.from} ${scheme.to} mb-2`} />
                  <span className="text-sm font-medium text-gray-700">{scheme.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Additional Description */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Additional Details (Optional)
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-purple-500 focus:border-transparent transition"
              rows="4"
              placeholder="Any specific requirements, features, or style preferences..."
            />
          </div>

          {/* Image Upload */}
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">
              Upload Images (Optional)
            </label>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-purple-400 transition">
              <Upload className="w-8 h-8 text-gray-400 mx-auto mb-2" />
              <label className="cursor-pointer">
                <span className="text-purple-600 hover:text-purple-700 font-medium">
                  Choose files
                </span>
                <input
                  type="file"
                  multiple
                  accept="image/*"
                  onChange={handleImageUpload}
                  className="hidden"
                />
              </label>
              <p className="text-sm text-gray-500 mt-1">PNG, JPG, GIF up to 10MB</p>
            </div>

            {uploadedImages.length > 0 && (
              <div className="mt-4 grid grid-cols-2 md:grid-cols-4 gap-3">
                {uploadedImages.map((img, index) => (
                  <div key={index} className="relative group">
                    <img
                      src={img.url}
                      alt={img.name}
                      className="w-full h-32 object-cover rounded-lg"
                    />
                    <button
                      onClick={() => removeImage(index)}
                      className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 opacity-0 group-hover:opacity-100 transition"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Generate Button */}
          <button
            onClick={generateWebsite}
            disabled={isGenerating}
            className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all ${
              isGenerating
                ? 'bg-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 shadow-lg hover:shadow-xl text-white'
            }`}
          >
            {isGenerating ? (
              <div className="flex items-center justify-center gap-3">
                <div className="w-6 h-6 border-4 border-white border-t-transparent rounded-full animate-spin" />
                <span>{generationStep}</span>
              </div>
            ) : (
              <div className="flex items-center justify-center gap-2">
                <Wand2 className="w-6 h-6" />
                <span>Generate Website with AI</span>
              </div>
            )}
          </button>

          {isGenerating && (
            <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
              <div
                className="bg-gradient-to-r from-purple-600 to-blue-600 h-full transition-all duration-500"
                style={{ width: `${generationProgress}%` }}
              />
            </div>
          )}
        </div>

        <p className="text-center text-sm text-gray-500 mt-6">
          Powered by Claude AI • Your data is not stored
        </p>
      </div>
    </div>
  );
};

export default AIWebsiteBuilder;
