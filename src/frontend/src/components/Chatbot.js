import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import './Chatbot.css';

const Chatbot = () => {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const messagesEndRef = useRef(null);
  
  // Theme settings
  const [settings, setSettings] = useState({
    position: 'bottom-right',
    primaryColor: '#5c6ac4',
    secondaryColor: '#f0f2f5',
    fontFamily: 'inherit',
    fontSize: '14px',
    enableNotifications: true,
    saveHistory: true
  });

  // Apply theme settings to chatbot
  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--chatbot-primary-color', settings.primaryColor);
    root.style.setProperty('--chatbot-secondary-color', settings.secondaryColor);
    root.style.setProperty('--chatbot-font-family', settings.fontFamily);
    root.style.setProperty('--chatbot-font-size', settings.fontSize);
    
    // Apply position
    const container = document.querySelector('.chatbot-container');
    if (container) {
      container.className = `chatbot-container ${settings.position}`;
    }
  }, [settings]);

  // Load settings from localStorage on mount
  useEffect(() => {
    const savedSettings = localStorage.getItem('chatbotSettings');
    if (savedSettings) {
      setSettings(JSON.parse(savedSettings));
    }
    
    // Try to inherit shop theme colors if in Shopify environment
    if (window.Shopify && window.Shopify.theme) {
      const shopifyColors = {
        primaryColor: window.Shopify.theme.style.buttonPrimaryBackground || settings.primaryColor,
        secondaryColor: window.Shopify.theme.style.colorBackground || settings.secondaryColor,
        fontFamily: window.Shopify.theme.style.typeHeadingFamily || settings.fontFamily
      };
      setSettings(prev => ({ ...prev, ...shopifyColors }));
    }
  }, []);

  // Scroll to bottom of messages
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!input.trim()) return;

    const userMessage = { text: input, sender: 'user' };
    setMessages([...messages, userMessage]);
    setInput('');

    try {
      // Add loading message
      setMessages(prev => [...prev, { text: '...', sender: 'bot', loading: true }]);
      
      // Call backend API with the correct URL
      const response = await axios.post('http://localhost:3000/api/chat', { message: input });
      
      // Remove loading message and add actual response
      setMessages(prev => {
        const filtered = prev.filter(msg => !msg.loading);
        return [...filtered, { text: response.data.reply, sender: 'bot' }];
      });
      
      // Save messages to localStorage if enabled
      if (settings.saveHistory) {
        localStorage.setItem('chatHistory', JSON.stringify([...messages, userMessage, { text: response.data.reply, sender: 'bot' }]));
      }
    } catch (error) {
      console.error('Error sending message:', error);
      
      // Remove loading message and add error message
      setMessages(prev => {
        const filtered = prev.filter(msg => !msg.loading);
        return [...filtered, { 
          text: 'Sorry, I encountered an error. Please try again later.', 
          sender: 'bot', 
          error: true 
        }];
      });
    }
  };

  const handleSettingChange = (key, value) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const saveSettings = () => {
    localStorage.setItem('chatbotSettings', JSON.stringify(settings));
    setShowSettings(false);
  };

  const clearHistory = () => {
    setMessages([]);
    localStorage.removeItem('chatHistory');
  };

  return (
    <div className={`chatbot-container ${settings.position}`} style={{ 
      '--chatbot-primary-color': settings.primaryColor,
      '--chatbot-secondary-color': settings.secondaryColor,
      fontFamily: settings.fontFamily,
      fontSize: settings.fontSize
    }}>
      <button 
        className="chatbot-toggle"
        onClick={() => setIsOpen(!isOpen)}
        style={{ backgroundColor: settings.primaryColor }}
      >
        {isOpen ? 'Close Chat' : 'Chat with us'}
      </button>
      
      {isOpen && (
        <div className="chatbot-window">
          <div className="chatbot-header" style={{ backgroundColor: settings.primaryColor }}>
            <h3>Iris Essentials Assistant</h3>
            <div className="header-buttons">
              <button 
                className="settings-button" 
                onClick={() => setShowSettings(!showSettings)}
                title="Settings"
              >
                ⚙️
              </button>
              <button onClick={() => setIsOpen(false)}>×</button>
            </div>
          </div>
          
          {showSettings ? (
            <div className="chatbot-settings">
              <h4>Chat Settings</h4>
              
              <h5>Position</h5>
              <div className="position-options">
                <div 
                  className={`position-option ${settings.position === 'bottom-right' ? 'active' : ''}`}
                  onClick={() => handleSettingChange('position', 'bottom-right')}
                >
                  Bottom Right
                </div>
                <div 
                  className={`position-option ${settings.position === 'bottom-left' ? 'active' : ''}`}
                  onClick={() => handleSettingChange('position', 'bottom-left')}
                >
                  Bottom Left
                </div>
                <div 
                  className={`position-option ${settings.position === 'top-right' ? 'active' : ''}`}
                  onClick={() => handleSettingChange('position', 'top-right')}
                >
                  Top Right
                </div>
                <div 
                  className={`position-option ${settings.position === 'top-left' ? 'active' : ''}`}
                  onClick={() => handleSettingChange('position', 'top-left')}
                >
                  Top Left
                </div>
              </div>
              
              <h5>Colors</h5>
              <div className="color-settings">
                <div className="color-option">
                  <label>Primary Color</label>
                  <input 
                    type="color" 
                    value={settings.primaryColor}
                    onChange={(e) => handleSettingChange('primaryColor', e.target.value)}
                  />
                </div>
                <div className="color-option">
                  <label>Secondary Color</label>
                  <input 
                    type="color" 
                    value={settings.secondaryColor}
                    onChange={(e) => handleSettingChange('secondaryColor', e.target.value)}
                  />
                </div>
              </div>
              
              <h5>Font</h5>
              <div className="font-settings">
                <div className="font-option">
                  <label>Font Family</label>
                  <select 
                    value={settings.fontFamily}
                    onChange={(e) => handleSettingChange('fontFamily', e.target.value)}
                  >
                    <option value="inherit">Default</option>
                    <option value="Arial, sans-serif">Arial</option>
                    <option value="Helvetica, sans-serif">Helvetica</option>
                    <option value="Georgia, serif">Georgia</option>
                    <option value="'Times New Roman', serif">Times New Roman</option>
                    <option value="'Courier New', monospace">Courier New</option>
                  </select>
                </div>
                <div className="font-option">
                  <label>Font Size</label>
                  <select 
                    value={settings.fontSize}
                    onChange={(e) => handleSettingChange('fontSize', e.target.value)}
                  >
                    <option value="12px">Small</option>
                    <option value="14px">Medium</option>
                    <option value="16px">Large</option>
                    <option value="18px">Extra Large</option>
                  </select>
                </div>
              </div>
              
              <h5>Other Settings</h5>
              <div className="settings-option">
                <label>
                  <input 
                    type="checkbox" 
                    checked={settings.enableNotifications}
                    onChange={(e) => handleSettingChange('enableNotifications', e.target.checked)}
                  />
                  Enable notifications
                </label>
              </div>
              <div className="settings-option">
                <label>
                  <input 
                    type="checkbox" 
                    checked={settings.saveHistory}
                    onChange={(e) => handleSettingChange('saveHistory', e.target.checked)}
                  />
                  Save chat history
                </label>
              </div>
              
              <button className="save-settings" onClick={saveSettings}>
                Save Settings
              </button>
              
              <button className="clear-history" onClick={clearHistory}>
                Clear Chat History
              </button>
              
              <button className="back-to-chat" onClick={() => setShowSettings(false)}>
                Back to Chat
              </button>
            </div>
          ) : (
            <>
              <div className="chat-messages">
                {messages.length === 0 ? (
                  <div className="welcome-message">
                    <p>👋 Hi there! How can I help you today?</p>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div 
                      key={index} 
                      className={`message ${message.sender} ${message.error ? 'error' : ''}`}
                      style={{
                        backgroundColor: message.sender === 'user' ? settings.primaryColor : settings.secondaryColor,
                        color: message.sender === 'user' ? 'white' : '#333'
                      }}
                    >
                      {message.text}
                    </div>
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
              <form onSubmit={sendMessage} className="chat-input-form">
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder="Type your message..."
                />
                <button type="submit" style={{ backgroundColor: settings.primaryColor }}>Send</button>
              </form>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Chatbot;