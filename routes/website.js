function generateChatWidgetCode(userId, agentConfig) {
  const agentName = agentConfig?.agentName || 'Kurt';
  const greetingMessage = agentConfig?.greetingMessage || "Hey it's Kurt, I just happened to look and saw you were browsing. What are you looking to get done?";
  const autoOpenDelay = agentConfig?.autoOpenDelay || 3;
  const apiUrl = process.env.RAILWAY_PUBLIC_DOMAIN 
    ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` 
    : process.env.API_URL || 'https://backend-production-ab50.up.railway.app';

  return `
<!-- SORCE Chat Agent -->
<div id="sorce-chat-widget"></div>
<style>
#sorce-chat-widget {
  position: fixed;
  bottom: 20px;
  right: 20px;
  z-index: 9999;
}
.chat-bubble {
  width: 60px;
  height: 60px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  transition: transform 0.2s;
}
.chat-bubble:hover {
  transform: scale(1.1);
}
.chat-bubble svg {
  width: 28px;
  height: 28px;
  color: white;
}
.chat-window {
  position: fixed;
  bottom: 90px;
  right: 20px;
  width: 380px;
  height: 600px;
  background: white;
  border-radius: 16px;
  box-shadow: 0 8px 32px rgba(0,0,0,0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: scale(0);
  transform-origin: bottom right;
  transition: transform 0.3s ease;
}
.chat-window.open {
  transform: scale(1);
}
.chat-header {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  padding: 20px;
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.chat-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
.chat-close {
  background: none;
  border: none;
  color: white;
  cursor: pointer;
  font-size: 24px;
  padding: 0;
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  background: #f9fafb;
}
.chat-message {
  margin-bottom: 16px;
  display: flex;
  gap: 12px;
}
.chat-message.agent .message-bubble {
  background: white;
  color: #1f2937;
  border: 1px solid #e5e7eb;
}
.chat-message.user .message-bubble {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  margin-left: auto;
}
.message-bubble {
  max-width: 75%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  line-height: 1.5;
}
.chat-input-area {
  padding: 16px;
  border-top: 1px solid #e5e7eb;
  background: white;
}
.chat-input {
  width: 100%;
  padding: 12px;
  border: 2px solid #e5e7eb;
  border-radius: 8px;
  font-size: 14px;
  resize: none;
}
.chat-input:focus {
  outline: none;
  border-color: #667eea;
}
.chat-send-btn {
  margin-top: 8px;
  width: 100%;
  padding: 12px;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.2s;
}
.chat-send-btn:hover {
  opacity: 0.9;
}
.chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.typing-indicator {
  display: flex;
  gap: 4px;
  padding: 12px 16px;
}
.typing-dot {
  width: 8px;
  height: 8px;
  background: #9ca3af;
  border-radius: 50%;
  animation: typing 1.4s infinite;
}
.typing-dot:nth-child(2) { animation-delay: 0.2s; }
.typing-dot:nth-child(3) { animation-delay: 0.4s; }
@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-10px); }
}
@media (max-width: 480px) {
  .chat-window {
    width: calc(100vw - 40px);
    height: calc(100vh - 120px);
    right: 20px;
    bottom: 90px;
  }
}
</style>
<script>
(function() {
  console.log('🤖 SORCE Chat Widget - Initializing...');
  console.log('User ID:', '${userId}');
  console.log('API URL:', '${apiUrl}');
  console.log('Agent Name:', '${agentName.replace(/'/g, "\\'")}');
  console.log('Auto-open delay:', ${autoOpenDelay}, 'seconds');
  
  const userId = '${userId}';
  const apiUrl = '${apiUrl}';
  const agentName = '${agentName.replace(/'/g, "\\'")}';
  const greetingMessage = '${greetingMessage.replace(/'/g, "\\'")}';
  const autoOpenDelay = ${autoOpenDelay};
  
  let conversationId = null;
  let isOpen = false;
  
  function createChatWidget() {
    console.log('🔧 Creating chat widget DOM elements...');
    const widget = document.getElementById('sorce-chat-widget');
    
    if (!widget) {
      console.error('❌ Could not find #sorce-chat-widget element!');
      return;
    }
    
    console.log('✅ Found widget container');
    
    widget.innerHTML = \`
      <div class="chat-bubble" onclick="toggleChat()">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"></path>
        </svg>
      </div>
      <div class="chat-window" id="chat-window">
        <div class="chat-header">
          <h3>Chat with \${agentName}</h3>
          <button class="chat-close" onclick="toggleChat()">×</button>
        </div>
        <div class="chat-messages" id="chat-messages"></div>
        <div class="chat-input-area">
          <textarea 
            class="chat-input" 
            id="chat-input" 
            placeholder="Type your message..."
            rows="2"
            onkeypress="handleKeyPress(event)"
          ></textarea>
          <button class="chat-send-btn" onclick="sendMessage()">Send Message</button>
        </div>
      </div>
    \`;
    
    console.log('✅ Chat widget HTML injected');
    
    // Auto-open after delay
    console.log(\`⏱️ Will auto-open in \${autoOpenDelay} seconds...\`);
    setTimeout(() => {
      const hasOpened = sessionStorage.getItem('chat-opened');
      console.log('Auto-open check - Has opened before?', hasOpened);
      
      if (!isOpen && !hasOpened) {
        console.log('🚀 Auto-opening chat widget...');
        toggleChat();
        addMessage(greetingMessage, 'agent');
        sessionStorage.setItem('chat-opened', 'true');
      } else {
        console.log('ℹ️ Skipping auto-open (already opened before)');
      }
    }, autoOpenDelay * 1000);
  }
  
  window.toggleChat = function() {
    isOpen = !isOpen;
    console.log('💬 Toggle chat - New state:', isOpen ? 'OPEN' : 'CLOSED');
    
    const chatWindow = document.getElementById('chat-window');
    if (!chatWindow) {
      console.error('❌ Could not find chat-window element!');
      return;
    }
    
    chatWindow.classList.toggle('open');
    
    if (isOpen && !conversationId) {
      console.log('🆕 Starting new conversation...');
      startConversation();
    }
  };
  
  window.handleKeyPress = function(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };
  
  async function startConversation() {
    console.log('📞 API Call: Starting conversation');
    console.log('Endpoint:', \`\${apiUrl}/api/chat/start\`);
    
    try {
      const response = await fetch(\`\${apiUrl}/api/chat/start\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, source: 'website' })
      });
      
      console.log('Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        conversationId = data.conversationId;
        console.log('✅ Conversation started! ID:', conversationId);
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to start conversation:', errorText);
      }
    } catch (error) {
      console.error('❌ Error starting conversation:', error);
    }
  }
  
  window.sendMessage = async function() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message) {
      console.log('⚠️ Empty message, not sending');
      return;
    }
    
    console.log('📤 Sending message:', message);
    
    addMessage(message, 'user');
    input.value = '';
    
    showTypingIndicator();
    
    console.log('📞 API Call: Sending message');
    console.log('Endpoint:', \`\${apiUrl}/api/chat/message\`);
    console.log('Conversation ID:', conversationId);
    
    try {
      const response = await fetch(\`\${apiUrl}/api/chat/message\`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId,
          conversationId,
          message
        })
      });
      
      console.log('Response status:', response.status);
      
      if (response.ok) {
        const data = await response.json();
        console.log('✅ Received reply:', data.reply);
        hideTypingIndicator();
        addMessage(data.reply, 'agent');
      } else {
        const errorText = await response.text();
        console.error('❌ Failed to send message:', errorText);
        throw new Error('Submission failed');
      }
    } catch (error) {
      console.error('❌ Error sending message:', error);
      hideTypingIndicator();
      addMessage('Sorry, I had trouble connecting. Please try again.', 'agent');
    }
  };
  
  function addMessage(text, type) {
    console.log(\`💬 Adding \${type} message:`, text);
    const messagesDiv = document.getElementById('chat-messages');
    const messageEl = document.createElement('div');
    messageEl.className = \`chat-message \${type}\`;
    messageEl.innerHTML = \`<div class="message-bubble">\${escapeHtml(text)}</div>\`;
    messagesDiv.appendChild(messageEl);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  function showTypingIndicator() {
    console.log('⌛ Showing typing indicator...');
    const messagesDiv = document.getElementById('chat-messages');
    const indicator = document.createElement('div');
    indicator.id = 'typing-indicator';
    indicator.className = 'chat-message agent';
    indicator.innerHTML = \`
      <div class="message-bubble">
        <div class="typing-indicator">
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
          <div class="typing-dot"></div>
        </div>
      </div>
    \`;
    messagesDiv.appendChild(indicator);
    messagesDiv.scrollTop = messagesDiv.scrollHeight;
  }
  
  function hideTypingIndicator() {
    console.log('✅ Hiding typing indicator');
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }
  
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
  
  // Initialize widget
  console.log('📄 Document ready state:', document.readyState);
  if (document.readyState === 'loading') {
    console.log('⏳ Waiting for DOM to load...');
    document.addEventListener('DOMContentLoaded', function() {
      console.log('✅ DOM loaded, creating widget');
      createChatWidget();
    });
  } else {
    console.log('✅ DOM already loaded, creating widget immediately');
    createChatWidget();
  }
  
  console.log('🎉 SORCE Chat Widget script loaded successfully');
})();
</script>
<!-- End SORCE Chat Agent -->
`;
}
