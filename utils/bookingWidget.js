/**
 * Generates a self-contained booking widget (HTML+CSS+JS) that opens as a modal
 * when any `a[href="#book-online"]` link is clicked.
 *
 * Multi-step flow: categories → services → addons → datetime → contact → payment → confirmation
 */
function generateBookingWidgetCode(userId, theme = {}) {
  const apiUrl = process.env.VITE_API_URL || process.env.BACKEND_URL || 'https://backend-production-ab50.up.railway.app';
  const primary = theme.primaryColor || '#2563eb';

  return `
<!-- SORCE Booking Widget -->
<div id="sorce-booking-overlay" style="display:none;position:fixed;inset:0;z-index:99999;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);align-items:center;justify-content:center;">
  <div id="sorce-booking-modal" style="position:relative;width:95%;max-width:560px;max-height:90vh;overflow-y:auto;background:#fff;border-radius:16px;box-shadow:0 25px 60px rgba(0,0,0,.3);padding:0;">
    <button id="sorce-booking-close" style="position:sticky;top:0;float:right;margin:12px 12px 0 0;width:36px;height:36px;border-radius:50%;border:none;cursor:pointer;background:#f3f4f6;color:#374151;font-size:20px;display:flex;align-items:center;justify-content:center;z-index:10;">&times;</button>
    <div id="sorce-booking-content" style="padding:8px 28px 28px;"></div>
  </div>
</div>
<style>
  #sorce-booking-overlay.open{display:flex!important}
  #sorce-booking-modal{animation:sbkSlideUp .25s ease}
  @keyframes sbkSlideUp{from{opacity:0;transform:translateY(30px)}to{opacity:1;transform:translateY(0)}}
  .sbk-step{display:none}.sbk-step.active{display:block}
  .sbk-title{font-size:22px;font-weight:700;color:#111;margin:0 0 6px}
  .sbk-sub{font-size:14px;color:#6b7280;margin:0 0 20px}
  .sbk-card{border:2px solid #e5e7eb;border-radius:12px;padding:16px;cursor:pointer;transition:border .15s,box-shadow .15s;margin-bottom:10px}
  .sbk-card:hover,.sbk-card.sel{border-color:${primary};box-shadow:0 0 0 3px ${primary}22}
  .sbk-card h4{margin:0 0 4px;font-size:16px;font-weight:600;color:#111}
  .sbk-card p{margin:0;font-size:13px;color:#6b7280}
  .sbk-price{font-size:20px;font-weight:700;color:${primary}}
  .sbk-dur{font-size:13px;color:#9ca3af}
  .sbk-row{display:flex;justify-content:space-between;align-items:center}
  .sbk-btn{display:block;width:100%;padding:14px;border:none;border-radius:10px;background:${primary};color:#fff;font-size:16px;font-weight:600;cursor:pointer;transition:opacity .15s;margin-top:16px}
  .sbk-btn:hover{opacity:.9}
  .sbk-btn:disabled{opacity:.5;cursor:not-allowed}
  .sbk-btn-back{background:none;border:none;color:#6b7280;font-size:14px;cursor:pointer;padding:0;margin-bottom:12px;display:flex;align-items:center;gap:4px}
  .sbk-btn-back:hover{color:#111}
  .sbk-input{width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:8px;font-size:15px;outline:none;transition:border .15s;box-sizing:border-box;margin-bottom:10px}
  .sbk-input:focus{border-color:${primary}}
  .sbk-label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px}
  .sbk-req{color:#ef4444}
  .sbk-slots{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;margin:12px 0}
  .sbk-slot{padding:10px 8px;border:2px solid #e5e7eb;border-radius:8px;text-align:center;cursor:pointer;font-size:14px;font-weight:500;transition:all .15s}
  .sbk-slot:hover,.sbk-slot.sel{border-color:${primary};background:${primary};color:#fff}
  .sbk-cal{border:2px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:16px}
  .sbk-cal-header{display:flex;align-items:center;justify-content:space-between;padding:12px 16px;background:#f9fafb}
  .sbk-cal-header button{background:none;border:none;cursor:pointer;padding:6px 10px;border-radius:8px;font-size:18px;color:#374151;transition:background .15s}
  .sbk-cal-header button:hover{background:#e5e7eb}
  .sbk-cal-header span{font-weight:700;font-size:15px;color:#111}
  .sbk-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);text-align:center}
  .sbk-cal-dow{padding:8px 0;font-size:11px;font-weight:600;color:#9ca3af;text-transform:uppercase}
  .sbk-cal-day{padding:8px 0;font-size:14px;color:#d1d5db;position:relative;cursor:default}
  .sbk-cal-day.avail{color:#111;cursor:pointer;font-weight:500}
  .sbk-cal-day.avail:hover{background:#f3f4f6}
  .sbk-cal-day.sel{background:${primary};color:#fff;font-weight:700}
  .sbk-cal-day.sel:hover{background:${primary}}
  .sbk-cal-day.today::after{content:'';position:absolute;bottom:3px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:${primary}}
  .sbk-cal-day.sel.today::after{background:#fff}
  .sbk-times-section{animation:sbkFadeIn .2s ease}
  @keyframes sbkFadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
  .sbk-summary{background:#f9fafb;border-radius:10px;padding:16px;margin-bottom:16px}
  .sbk-summary-row{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}
  .sbk-summary-row span:last-child{font-weight:600}
  .sbk-check{display:flex;align-items:center;width:16px;height:16px;border-radius:50%;background:#10b981;color:#fff;font-size:11px;justify-content:center;margin-right:8px}
  .sbk-success{text-align:center;padding:30px 0}
  .sbk-success h3{font-size:24px;font-weight:700;color:#111;margin:12px 0 8px}
  .sbk-error{background:#fef2f2;border:1px solid #fecaca;color:#b91c1c;padding:10px 14px;border-radius:8px;font-size:14px;margin-bottom:12px}
  .sbk-loading{display:flex;align-items:center;justify-content:center;padding:40px;color:#9ca3af}
  .sbk-spin{width:24px;height:24px;border:3px solid #e5e7eb;border-top-color:${primary};border-radius:50%;animation:sbkSpin .6s linear infinite;margin-right:10px}
  @keyframes sbkSpin{to{transform:rotate(360deg)}}
  .sbk-cat-grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:12px}
  .sbk-cat-card{position:relative;border-radius:12px;height:120px;cursor:pointer;overflow:hidden;background:#e5e7eb;background-size:cover;background-position:center;display:flex;flex-direction:column;justify-content:flex-end;padding:14px;transition:transform .15s,box-shadow .15s}
  .sbk-cat-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.15)}
  .sbk-cat-card::before{content:'';position:absolute;inset:0;background:linear-gradient(transparent 30%,rgba(0,0,0,.65));border-radius:12px}
  .sbk-cat-card h4{position:relative;z-index:1;margin:0;font-size:16px;font-weight:700;color:#fff}
  .sbk-cat-card .sbk-cat-count{position:relative;z-index:1;display:inline-block;margin-top:4px;background:rgba(255,255,255,.25);backdrop-filter:blur(4px);color:#fff;font-size:11px;font-weight:600;padding:2px 8px;border-radius:10px}
  .sbk-svc-img{width:60px;height:60px;border-radius:50%;object-fit:cover;flex-shrink:0;margin-right:14px}
  .sbk-addon-row{display:flex;align-items:center;padding:12px 0;border-bottom:1px solid #f3f4f6}
  .sbk-addon-row:last-child{border-bottom:none}
  .sbk-addon-check{width:20px;height:20px;accent-color:${primary};cursor:pointer;flex-shrink:0;margin-right:12px}
  .sbk-total-bar{position:sticky;bottom:0;background:#fff;border-top:2px solid #f3f4f6;padding:14px 0 0;margin-top:12px;display:flex;justify-content:space-between;align-items:center}
  .sbk-steps-indicator{display:flex;align-items:center;justify-content:center;gap:6px;margin-bottom:18px;padding-top:4px}
  .sbk-steps-indicator .sbk-dot{width:8px;height:8px;border-radius:50%;background:#e5e7eb;transition:background .2s}
  .sbk-steps-indicator .sbk-dot.active{background:${primary}}
  .sbk-steps-indicator .sbk-dot.done{background:${primary};opacity:.4}
  .sbk-stripe-card{border:2px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;transition:border .15s}
  .sbk-stripe-card.StripeElement--focus{border-color:${primary}}
  .sbk-svc-card-inner{display:flex;align-items:center}
  .sbk-svc-card-info{flex:1;min-width:0}
</style>
<script>
(function(){
  var API='${apiUrl}';
  var UID='${userId}';
  var PRIMARY='${primary}';
  var overlay=document.getElementById('sorce-booking-overlay');
  var content=document.getElementById('sorce-booking-content');

  var state={
    step:'loading',
    config:null,
    categories:[],
    services:[],
    addonMap:{},
    uncategorized:[],
    hours:[],
    biz:null,
    selCategory:null,
    selService:null,
    selAddons:[],
    selDate:'',
    selTime:'',
    slots:[],
    taxRate:0,
    subtotal:0,
    taxAmount:0,
    loading:false,
    error:null,
    success:false,
    bookingNum:'',
    cust:{name:'',email:'',phone:'',notes:''},
    totalPrice:0,
    stripeReady:false,
    stripeInstance:null,
    cardElement:null,
    clientSecret:'',
    squareCard:null,
    squarePayments:null,
    cofCardToken:null,
    calMonth:new Date().getMonth(),
    calYear:new Date().getFullYear()
  };

  function open(){
    overlay.classList.add('open');
    document.body.style.overflow='hidden';
    if(!state.services.length)loadData();
    else render();
  }
  function close(){overlay.classList.remove('open');document.body.style.overflow=''}

  document.getElementById('sorce-booking-close').onclick=close;
  overlay.addEventListener('click',function(e){if(e.target===overlay)close()});

  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href="#book-online"],a[href="/booking"],a[href="#contact"]');
    if(a){e.preventDefault();open()}
  });

  function loadData(){
    state.loading=true;state.step='loading';render();
    Promise.all([
      fetch(API+'/api/public/services?businessId='+UID).then(function(r){return r.json()}),
      fetch(API+'/api/public/business-hours?businessId='+UID).then(function(r){return r.json()}),
      fetch(API+'/api/public/business-info?businessId='+UID).then(function(r){return r.json()}),
      fetch(API+'/api/public/booking-widget-config?businessId='+UID).then(function(r){return r.json()})
    ]).then(function(res){
      state.services=res[0].services||[];
      state.categories=res[0].categories||[];
      state.uncategorized=res[0].uncategorized||[];
      state.addonMap=res[0].addonMap||{};
      state.taxRate=parseFloat(res[0].taxRate||0);
      state.hours=res[1].businessHours||[];
      state.biz=res[2].business||null;
      state.config=res[3].config||null;
      state.loading=false;
      state.step=state.categories.length>0?'categories':'services';
      render();
    }).catch(function(){state.loading=false;state.error='Failed to load booking info';state.step='services';render()});
  }

  function getServicesByCategory(catId){
    var cat=state.categories.find(function(c){return c.id===catId});
    if(cat&&cat.services)return cat.services;
    return state.services.filter(function(s){return s.category_id===catId&&!s.is_addon});
  }

  function getVisibleServices(){
    if(state.selCategory){
      return getServicesByCategory(state.selCategory.id);
    }
    if(state.uncategorized.length)return state.uncategorized;
    return state.services.filter(function(s){return !s.is_addon});
  }

  function getAddonsForService(serviceId){
    var ids=state.addonMap[serviceId]||[];
    if(!ids.length)return[];
    return state.services.filter(function(s){
      return ids.indexOf(s.id)!==-1;
    });
  }

  function calcTotal(){
    var t=0;
    if(state.selService)t+=parseFloat(state.selService.price)||0;
    state.selAddons.forEach(function(a){t+=parseFloat(a.price)||0});
    state.subtotal=t;
    var taxAmt=state.taxRate>0?Math.round(t*state.taxRate*100)/100:0;
    state.taxAmount=taxAmt;
    state.totalPrice=t+taxAmt;
  }

  function getAllServiceIds(){
    var ids=[];
    if(state.selService)ids.push(state.selService.id);
    state.selAddons.forEach(function(a){ids.push(a.id)});
    return ids;
  }

  function loadSlots(){
    if(!state.selDate||!state.selService)return;
    state.loading=true;state.selTime='';render();
    var ids=getAllServiceIds().join(',');
    fetch(API+'/api/public/availability?businessId='+UID+'&serviceIds='+ids+'&date='+state.selDate)
      .then(function(r){return r.json()})
      .then(function(d){
        var slots=d.slots||[];
        var todayStr=new Date().toISOString().slice(0,10);
        if(state.selDate===todayStr){
          var now=new Date();
          var nowMins=now.getHours()*60+now.getMinutes();
          slots=slots.filter(function(s){var p=s.time.split(':');return parseInt(p[0])*60+parseInt(p[1])>nowMins;});
        }
        state.slots=slots;state.loading=false;render();
      })
      .catch(function(){state.loading=false;state.error='Failed to load available times';render()});
  }

  function isDateAvail(y,m,d){
    var dt=new Date(y,m,d);
    var now=new Date();now.setHours(0,0,0,0);
    if(dt<now)return false;
    var dow=dt.getDay();
    var hr=state.hours.find(function(x){return x.day_of_week===dow});
    return !!(hr&&hr.is_open);
  }

  function pad2(n){return n<10?'0'+n:''+n}

  function renderCalendar(){
    var y=state.calYear,m=state.calMonth;
    var months=['January','February','March','April','May','June','July','August','September','October','November','December'];
    var dows=['Su','Mo','Tu','We','Th','Fr','Sa'];
    var firstDay=new Date(y,m,1).getDay();
    var daysInMonth=new Date(y,m+1,0).getDate();
    var today=new Date();today.setHours(0,0,0,0);
    var h='<div class="sbk-cal">';
    h+='<div class="sbk-cal-header">';
    h+='<button data-caldir="-1">&lsaquo;</button>';
    h+='<span>'+months[m]+' '+y+'</span>';
    h+='<button data-caldir="1">&rsaquo;</button>';
    h+='</div>';
    h+='<div class="sbk-cal-grid">';
    for(var i=0;i<7;i++)h+='<div class="sbk-cal-dow">'+dows[i]+'</div>';
    for(var i=0;i<firstDay;i++)h+='<div class="sbk-cal-day"></div>';
    for(var d=1;d<=daysInMonth;d++){
      var avail=isDateAvail(y,m,d);
      var ds=y+'-'+pad2(m+1)+'-'+pad2(d);
      var isToday=(new Date(y,m,d).getTime()===today.getTime());
      var isSel=(state.selDate===ds);
      var cls='sbk-cal-day';
      if(avail)cls+=' avail';
      if(isSel)cls+=' sel';
      if(isToday)cls+=' today';
      if(avail)h+='<div class="'+cls+'" data-caldate="'+ds+'">'+d+'</div>';
      else h+='<div class="'+cls+'">'+d+'</div>';
    }
    h+='</div></div>';
    return h;
  }

  function needsPayment(){
    var cfg=state.config;
    if(!cfg)return false;
    // New config: paymentMode 'card_on_file' or 'pay_at_booking'
    if(cfg.paymentMode&&cfg.paymentMode!=='none')return!!cfg.paymentConnected;
    // Legacy compat
    return!!(cfg.requirePayment&&cfg.paymentConnected);
  }

  function getPaymentMode(){
    var cfg=state.config;
    if(!cfg)return'none';
    return cfg.paymentMode||'none';
  }

  function getDepositAmount(){
    var cfg=state.config;
    if(!cfg||!cfg.depositEnabled||getPaymentMode()!=='pay_at_booking')return state.totalPrice;
    if(cfg.depositType==='percent')return Math.round(state.totalPrice*(cfg.depositAmount||50)/100*100)/100;
    return Math.min(cfg.depositAmount||0,state.totalPrice);
  }

  function getContactFields(){
    var cfg=state.config;
    if(!cfg||!cfg.contactFields)return[
      {key:'name',label:'Full Name',type:'text',required:true,enabled:true},
      {key:'email',label:'Email',type:'email',required:true,enabled:true},
      {key:'phone',label:'Phone',type:'tel',required:true,enabled:true},
      {key:'notes',label:'Notes',type:'textarea',required:false,enabled:true}
    ];
    return cfg.contactFields.filter(function(f){return f.enabled});
  }

  function getStepList(){
    var steps=[];
    if(state.categories.length>0)steps.push('categories');
    steps.push('services');
    if(state.selService&&getAddonsForService(state.selService.id).length>0)steps.push('addons');
    steps.push('datetime');
    steps.push('contact');
    if(needsPayment())steps.push('payment');
    steps.push('confirmation');
    return steps;
  }

  function goStep(s){state.step=s;state.error=null;render()}

  function getPrevStep(){
    var steps=getStepList();
    var idx=steps.indexOf(state.step);
    if(idx>0)return steps[idx-1];
    return null;
  }

  function submit(){
    var c=state.cust;
    var fields=getContactFields();
    var missing=fields.filter(function(f){return f.required&&!c[f.key]});
    if(missing.length){state.error='Please fill in all required fields';render();return}
    state.loading=true;state.error=null;render();
    var addonIds=state.selAddons.map(function(a){return a.id});
    var custInfo={name:c.name||'',email:c.email||'',phone:c.phone||''};
    if(c.address)custInfo.address=c.address;
    var pMode=getPaymentMode();
    var payload={businessId:UID,serviceId:state.selService.id,additionalServiceIds:addonIds,bookingDate:state.selDate,startTime:state.selTime,customerInfo:custInfo,customerNotes:c.notes||'',assignmentType:'any'};
    if(pMode==='card_on_file'){
      payload.isCardOnFile=true;
      if(state.cofCardToken)payload.cardToken=state.cofCardToken;
    }
    fetch(API+'/api/public/bookings/create',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify(payload)
    }).then(function(r){return r.json()}).then(function(d){
      if(d.success){state.success=true;state.bookingNum=d.bookingNumber;state.step='confirmation'}else{state.error=d.error||'Booking failed'}
      state.loading=false;render();
    }).catch(function(){state.loading=false;state.error='Failed to submit booking';render()});
  }

  function loadStripeJs(cb){
    if(window.Stripe){cb();return}
    var sc=document.createElement('script');
    sc.src='https://js.stripe.com/v3/';
    sc.onload=cb;
    sc.onerror=function(){state.error='Failed to load payment system';render()};
    document.head.appendChild(sc);
  }

  function initStripe(){
    if(!state.config||!state.config.stripePublicKey)return;
    loadStripeJs(function(){
      state.stripeInstance=window.Stripe(state.config.stripePublicKey);
      var elements=state.stripeInstance.elements();
      state.cardElement=elements.create('card',{style:{base:{fontSize:'16px',color:'#374151','::placeholder':{color:'#9ca3af'}}}});
      var el=document.querySelector('.sbk-stripe-card');
      if(el){state.cardElement.mount(el);state.stripeReady=true}
    });
  }

  function setupPayment(){
    state.loading=true;state.error=null;state.cofCardToken=null;render();
    calcTotal();
    var pMode=getPaymentMode();
    var proc=state.config&&state.config.paymentProcessor;
    if(proc==='square'){
      initSquare();
      return;
    }
    var chargeAmt=pMode==='card_on_file'?0:Math.round(getDepositAmount()*100);
    fetch(API+'/api/public/bookings/payment-setup',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({businessId:UID,amount:chargeAmt,customerEmail:state.cust.email,paymentMode:pMode})
    }).then(function(r){return r.json()}).then(function(d){
      if(d.clientSecret){
        state.clientSecret=d.clientSecret;
        state.loading=false;
        render();
        initStripe();
      }else{
        state.error=d.error||'Failed to initialize payment';
        state.loading=false;render();
      }
    }).catch(function(){state.loading=false;state.error='Failed to set up payment';render()});
  }

  function initSquare(){
    var cfg=state.config;
    if(!cfg||!cfg.squareAppId||!cfg.squareLocationId){
      state.error='Payment not configured';state.loading=false;render();return;
    }
    // Ensure window.setTimeout is writable before Square SDK loads
    // (Square SDK internally reassigns setTimeout which fails in some environments)
    try{Object.defineProperty(window,'setTimeout',{writable:true,configurable:true,value:window.setTimeout});}catch(e){}
    try{Object.defineProperty(window,'clearTimeout',{writable:true,configurable:true,value:window.clearTimeout});}catch(e){}
    var sdkUrl=cfg.squareEnvironment==='sandbox'
      ?'https://sandbox.web.squarecdn.com/v1/square.js'
      :'https://web.squarecdn.com/v1/square.js';
    function attachSquareCard(){
      try{
        window.Square.payments(cfg.squareAppId,cfg.squareLocationId)
          .card()
          .then(function(card){
            state.squareCard=card;
            state.loading=false;
            render();
            var el=document.getElementById('sbk-square-card');
            if(el)card.attach('#sbk-square-card');
          })
          .catch(function(e){
            state.error='Failed to initialize payment: '+(e.message||'');
            state.loading=false;render();
          });
      }catch(e){
        state.error='Payment initialization failed. Please try again.';
        state.loading=false;render();
      }
    }
    if(window.Square){attachSquareCard();return;}
    var sc=document.createElement('script');
    sc.src=sdkUrl;
    sc.onload=attachSquareCard;
    sc.onerror=function(){state.error='Failed to load payment system';state.loading=false;render();};
    document.head.appendChild(sc);
  }

  function confirmPayment(){
    var proc=state.config&&state.config.paymentProcessor;
    if(proc==='square'){
      if(!state.squareCard){state.error='Payment not ready';render();return}
      state.loading=true;state.error=null;render();
      state.squareCard.tokenize().then(function(result){
        if(result.status==='OK'){
          state.cofCardToken=result.token;
          submit();
        }else{
          var msg=(result.errors&&result.errors[0]&&result.errors[0].message)||'Card error';
          state.error=msg;state.loading=false;render();
        }
      }).catch(function(){state.error='Failed to process card';state.loading=false;render()});
      return;
    }
    if(!state.stripeInstance||!state.cardElement){state.error='Payment not ready';render();return}
    state.loading=true;state.error=null;render();
    var confirmFn=state.clientSecret.indexOf('seti_')===0
      ?state.stripeInstance.confirmCardSetup(state.clientSecret,{payment_method:{card:state.cardElement,billing_details:{email:state.cust.email,name:state.cust.name}}})
      :state.stripeInstance.confirmCardPayment(state.clientSecret,{payment_method:{card:state.cardElement,billing_details:{email:state.cust.email,name:state.cust.name}}});
    confirmFn.then(function(result){
      if(result.error){state.error=result.error.message;state.loading=false;render()}
      else{
        if(result.setupIntent&&result.setupIntent.payment_method){
          state.cofCardToken=result.setupIntent.payment_method;
        }
        submit();
      }
    });
  }

  function renderStepDots(){
    var steps=getStepList();
    var idx=steps.indexOf(state.step);
    if(idx<0)return'';
    var h='<div class="sbk-steps-indicator">';
    for(var i=0;i<steps.length;i++){
      var cls='sbk-dot';
      if(i<idx)cls+=' done';
      else if(i===idx)cls+=' active';
      h+='<div class="'+cls+'"></div>';
    }
    h+='</div>';
    return h;
  }

  function render(){
    if(state.step==='loading'){
      content.innerHTML='<div class="sbk-loading"><div class="sbk-spin"></div>Loading...</div>';
      return;
    }

    if(state.step==='confirmation'&&state.success){
      calcTotal();
      var ch='';
      ch+=renderStepDots();
      ch+='<div class="sbk-success">';
      ch+='<div style="width:60px;height:60px;border-radius:50%;background:#d1fae5;display:flex;align-items:center;justify-content:center;margin:0 auto">';
      ch+='<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div>';
      ch+='<h3>Booking Confirmed!</h3>';
      ch+='<p style="color:#6b7280;margin:0 0 16px">Confirmation #'+state.bookingNum+'</p>';
      ch+='<div class="sbk-summary">';
      ch+='<div class="sbk-summary-row"><span>Service</span><span>'+esc(state.selService.name)+'</span></div>';
      if(state.selAddons.length){
        state.selAddons.forEach(function(a){
          ch+='<div class="sbk-summary-row"><span style="color:#6b7280">+ '+esc(a.name)+'</span><span>$'+parseFloat(a.price).toFixed(2)+'</span></div>';
        });
      }
      ch+='<div class="sbk-summary-row"><span>Date</span><span>'+fmtDate(state.selDate)+'</span></div>';
      ch+='<div class="sbk-summary-row"><span>Time</span><span>'+(function(){var p=state.selTime.split(':');var h=parseInt(p[0]);var m=p[1];return(h%12||12)+':'+m+' '+(h>=12?'PM':'AM');})()+'</span></div>';
      if(state.taxAmount>0){
        ch+='<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="color:#6b7280">Subtotal</span><span>$'+state.subtotal.toFixed(2)+'</span></div>';
        ch+='<div class="sbk-summary-row"><span style="color:#6b7280">Tax ('+(state.taxRate*100).toFixed(2).replace(/\.?0+$/,'')+'%)</span><span>$'+state.taxAmount.toFixed(2)+'</span></div>';
        ch+='<div class="sbk-summary-row" style="padding-top:6px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$'+state.totalPrice.toFixed(2)+'</span></div>';
      }else{
        ch+='<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$'+state.totalPrice.toFixed(2)+'</span></div>';
      }
      ch+='</div>';
      ch+='<p style="font-size:14px;color:#6b7280">A confirmation email has been sent to '+esc(state.cust.email)+'</p>';
      ch+='<button class="sbk-btn" onclick="document.getElementById(\\'sorce-booking-overlay\\').classList.remove(\\'open\\');document.body.style.overflow=\\'\\'">Done</button>';
      ch+='</div>';
      content.innerHTML=ch;
      return;
    }

    var h='';
    h+=renderStepDots();
    if(state.error)h+='<div class="sbk-error">'+esc(state.error)+'</div>';

    var prev=getPrevStep();

    if(state.step==='categories'){
      h+='<h3 class="sbk-title">'+(state.biz?esc(state.biz.business_name):'Book Online')+'</h3>';
      h+='<p class="sbk-sub">Select a category to get started</p>';
      if(!state.categories.length){
        h+='<p style="color:#9ca3af;text-align:center;padding:20px">No categories available.</p>';
      }else{
        h+='<div class="sbk-cat-grid">';
        state.categories.forEach(function(cat){
          var count=cat.services?cat.services.length:getServicesByCategory(cat.id).length;
          var bgStyle=cat.image_url?'background-image:url('+esc(cat.image_url)+')':'background:#374151';
          h+='<div class="sbk-cat-card" data-catid="'+cat.id+'" style="'+bgStyle+'">';
          h+='<h4>'+esc(cat.name)+'</h4>';
          h+='<span class="sbk-cat-count">'+count+' service'+(count!==1?'s':'')+'</span>';
          h+='</div>';
        });
        h+='</div>';
      }
      if(state.uncategorized.length){
        h+='<p style="font-size:13px;color:#6b7280;margin:8px 0 4px">Other Services</p>';
        state.uncategorized.forEach(function(s){
          h+=renderServiceCard(s);
        });
      }

    }else if(state.step==='services'){
      if(prev)h+='<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h+='<h3 class="sbk-title">'+(state.selCategory?esc(state.selCategory.name):(state.biz?esc(state.biz.business_name):'Book Online'))+'</h3>';
      h+='<p class="sbk-sub">Select a service</p>';
      var svcs=getVisibleServices();
      if(!svcs.length)h+='<p style="color:#9ca3af;text-align:center;padding:20px">No services available.</p>';
      svcs.forEach(function(s){
        h+=renderServiceCard(s);
      });

    }else if(state.step==='addons'){
      if(prev)h+='<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h+='<h3 class="sbk-title">Add Extras</h3>';
      h+='<p class="sbk-sub">Enhance your '+esc(state.selService.name)+' experience</p>';
      var addons=getAddonsForService(state.selService.id);
      addons.forEach(function(a){
        var checked=state.selAddons.find(function(sa){return sa.id===a.id});
        h+='<div class="sbk-addon-row">';
        h+='<input type="checkbox" class="sbk-addon-check" data-addonid="'+a.id+'"'+(checked?' checked':'')+'>';
        h+='<div style="flex:1;min-width:0">';
        h+='<div style="font-weight:600;font-size:15px;color:#111">'+esc(a.name)+'</div>';
        if(a.description)h+='<div style="font-size:13px;color:#6b7280;margin-top:2px">'+esc(a.description)+'</div>';
        h+='</div>';
        h+='<div style="font-weight:700;color:'+PRIMARY+';font-size:15px;margin-left:12px;white-space:nowrap">+$'+parseFloat(a.price).toFixed(2)+'</div>';
        h+='</div>';
      });
      calcTotal();
      h+='<div class="sbk-total-bar">';
      if(state.taxAmount>0){
        h+='<div><span style="font-size:12px;color:#6b7280">Subtotal $'+state.subtotal.toFixed(2)+' + Tax $'+state.taxAmount.toFixed(2)+'</span><br><span style="font-size:20px;font-weight:700;color:#111">$'+state.totalPrice.toFixed(2)+'</span></div>';
      }else{
        h+='<div><span style="font-size:13px;color:#6b7280">Total</span><br><span style="font-size:20px;font-weight:700;color:#111">$'+state.totalPrice.toFixed(2)+'</span></div>';
      }
      h+='<button class="sbk-btn" style="width:auto;padding:14px 32px;margin:0" data-gonext="datetime">Continue &rarr;</button>';
      h+='</div>';

    }else if(state.step==='datetime'){
      if(prev)h+='<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h+='<h3 class="sbk-title">Choose Date & Time</h3>';
      calcTotal();
      h+='<div class="sbk-summary" style="padding:12px 14px;margin-bottom:14px">';
      h+='<div class="sbk-row"><span style="font-weight:600">'+esc(state.selService.name)+'</span><span class="sbk-price" style="font-size:16px">$'+state.totalPrice.toFixed(2)+'</span></div>';
      if(state.selAddons.length){
        state.selAddons.forEach(function(a){
          h+='<div class="sbk-row" style="margin-top:4px"><span style="font-size:13px;color:#6b7280">+ '+esc(a.name)+'</span><span style="font-size:13px;color:#6b7280">$'+parseFloat(a.price).toFixed(2)+'</span></div>';
        });
      }
      h+='</div>';
      h+=renderCalendar();
      if(state.selDate){
        h+='<div class="sbk-times-section">';
        h+='<label class="sbk-label">Available Times for '+fmtDate(state.selDate)+'</label>';
        if(state.loading)h+='<div class="sbk-loading" style="padding:20px"><div class="sbk-spin"></div></div>';
        else if(state.slots.length){
          h+='<div class="sbk-slots">';
          state.slots.forEach(function(s){h+='<div class="sbk-slot'+(state.selTime===s.time?' sel':'')+'" data-time="'+s.time+'">'+s.displayTime+'</div>'});
          h+='</div>';
        }else h+='<p style="color:#9ca3af;font-size:14px">No available times for this date.</p>';
        h+='</div>';
      }
      if(state.selDate&&state.selTime){
        h+='<button class="sbk-btn" data-gonext="contact">Continue &rarr;</button>';
      }

    }else if(state.step==='contact'){
      if(prev)h+='<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      h+='<h3 class="sbk-title">Your Information</h3>';
      calcTotal();
      h+='<div class="sbk-summary">';
      h+='<div class="sbk-summary-row"><span>Service</span><span>'+esc(state.selService.name)+'</span></div>';
      if(state.selAddons.length){
        state.selAddons.forEach(function(a){
          h+='<div class="sbk-summary-row"><span style="color:#6b7280">+ '+esc(a.name)+'</span><span>$'+parseFloat(a.price).toFixed(2)+'</span></div>';
        });
      }
      var bizLoc=[state.biz&&state.biz.address,state.biz&&state.biz.city,state.biz&&state.biz.state].filter(Boolean).join(', ');
      if(bizLoc)h+='<div class="sbk-summary-row"><span>Location</span><span style="text-align:right;max-width:60%">'+esc(bizLoc)+'</span></div>';
      h+='<div class="sbk-summary-row"><span>Date</span><span>'+fmtDate(state.selDate)+'</span></div>';
      h+='<div class="sbk-summary-row"><span>Time</span><span>'+(function(){var p=state.selTime.split(':');var h=parseInt(p[0]);var m=p[1];return(h%12||12)+':'+m+' '+(h>=12?'PM':'AM');})()+'</span></div>';
      var cPMode=getPaymentMode();
      if(state.taxAmount>0){
        h+='<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="color:#6b7280">Subtotal</span><span>$'+state.subtotal.toFixed(2)+'</span></div>';
        h+='<div class="sbk-summary-row"><span style="color:#6b7280">Tax ('+(state.taxRate*100).toFixed(2).replace(/\.?0+$/,'')+'%)</span><span>$'+state.taxAmount.toFixed(2)+'</span></div>';
        h+='<div class="sbk-summary-row" style="padding-top:6px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$'+state.totalPrice.toFixed(2)+'</span></div>';
      }else{
        h+='<div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$'+state.totalPrice.toFixed(2)+'</span></div>';
      }
      if(cPMode==='card_on_file'){
        h+='<div class="sbk-summary-row" style="padding-top:6px"><span style="font-weight:700;color:#16a34a">Due Today</span><span style="font-weight:700;color:#16a34a">$0.00</span></div>';
      }
      h+='</div>';
      if(cPMode==='card_on_file'){
        h+='<div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:12px 14px;margin-bottom:14px;display:flex;align-items:flex-start;gap:10px">';
        h+='<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" style="flex-shrink:0;margin-top:1px"><rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/></svg>';
        h+='<div><p style="margin:0;font-size:13px;font-weight:600;color:#1d4ed8">Card on file required</p><p style="margin:4px 0 0;font-size:12px;color:#3b82f6">Your card will be saved securely. You won\'t be charged until your appointment.</p></div>';
        h+='</div>';
      }
      var cfields=getContactFields();
      cfields.forEach(function(f){
        var reqMark=f.required?'<span class="sbk-req">*</span>':'';
        h+='<label class="sbk-label">'+esc(f.label)+' '+reqMark+'</label>';
        if(f.type==='textarea'){
          h+='<textarea class="sbk-input" data-field="'+f.key+'" rows="2" placeholder="'+esc(f.label)+'..." style="resize:vertical">'+esc(state.cust[f.key]||'')+'</textarea>';
        }else{
          h+='<input class="sbk-input" data-field="'+f.key+'" type="'+(f.type||'text')+'" value="'+esc(state.cust[f.key]||'')+'" placeholder="'+esc(f.label)+'...">';
        }
      });
      if(needsPayment()){
        h+='<button class="sbk-btn" id="sbk-to-payment"'+(state.loading?' disabled':'')+'>Continue to Payment &rarr;</button>';
      }else{
        h+='<button class="sbk-btn" id="sbk-submit"'+(state.loading?' disabled':'')+'>'+( state.loading?'<span class="sbk-spin" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></span>Confirming...':'Confirm Booking')+'</button>';
      }
      h+='<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:10px">You\\'ll receive a confirmation email</p>';

    }else if(state.step==='payment'){
      if(prev)h+='<button class="sbk-btn-back" data-goback>&larr; Back</button>';
      var pMode=getPaymentMode();
      h+='<h3 class="sbk-title">'+(pMode==='card_on_file'?'Save Card':'Payment')+'</h3>';
      h+='<p class="sbk-sub">'+(pMode==='card_on_file'?'Your card will be saved securely but not charged now':'Enter your payment details')+'</p>';
      calcTotal();
      var depAmt=getDepositAmount();
      h+='<div class="sbk-summary" style="margin-bottom:20px">';
      if(pMode==='card_on_file'){
        h+='<div class="sbk-summary-row" style="font-weight:700"><span>Service Total</span><span class="sbk-price" style="font-size:18px">$'+state.totalPrice.toFixed(2)+'</span></div>';
        h+='<div class="sbk-summary-row" style="font-size:13px;color:#6b7280"><span>Charged at appointment</span></div>';
      }else{
        h+='<div class="sbk-summary-row" style="font-weight:700"><span>Due Now</span><span class="sbk-price" style="font-size:18px">$'+depAmt.toFixed(2)+'</span></div>';
        if(depAmt<state.totalPrice){
          h+='<div class="sbk-summary-row" style="font-size:13px;color:#6b7280"><span>Remainder due at appointment</span><span>$'+(state.totalPrice-depAmt).toFixed(2)+'</span></div>';
        }
      }
      h+='</div>';
      var cProc=state.config&&state.config.paymentProcessor;
      if(state.loading){
        h+='<div class="sbk-loading" style="padding:20px"><div class="sbk-spin"></div>Setting up payment...</div>';
      }else{
        h+='<label class="sbk-label">Card Details</label>';
        if(cProc==='square'){
          h+='<div id="sbk-square-card" style="border:2px solid #e5e7eb;border-radius:8px;padding:14px;margin-bottom:12px;min-height:48px;"></div>';
        }else{
          h+='<div class="sbk-stripe-card"></div>';
        }
        if(pMode==='card_on_file'){
          h+='<button class="sbk-btn" id="sbk-pay">Save Card & Confirm</button>';
        }else{
          h+='<button class="sbk-btn" id="sbk-pay">Pay $'+depAmt.toFixed(2)+'</button>';
        }
      }
      var securedBy=cProc==='square'?'Square':'Stripe';
      h+='<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:10px"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="display:inline;vertical-align:middle;margin-right:4px"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>Secured by '+securedBy+'</p>';
    }

    content.innerHTML=h;
    bindEvents();
  }

  function renderServiceCard(s){
    var h='<div class="sbk-card" data-sid="'+s.id+'">';
    h+='<div class="sbk-svc-card-inner">';
    if(s.image_url)h+='<img class="sbk-svc-img" src="'+esc(s.image_url)+'" alt="'+esc(s.name)+'">';
    h+='<div class="sbk-svc-card-info">';
    h+='<h4>'+esc(s.name)+'</h4>';
    if(s.description)h+='<p>'+esc(s.description)+'</p>';
    h+='<div class="sbk-row" style="margin-top:8px"><span class="sbk-price">$'+parseFloat(s.price).toFixed(2)+'</span><span class="sbk-dur">'+s.duration_hours+'h</span></div>';
    h+='</div></div></div>';
    return h;
  }

  function bindEvents(){
    // Category clicks
    content.querySelectorAll('.sbk-cat-card').forEach(function(el){
      el.onclick=function(){
        var cid=parseInt(el.getAttribute('data-catid'));
        state.selCategory=state.categories.find(function(c){return c.id===cid})||null;
        goStep('services');
      };
    });

    // Service clicks
    content.querySelectorAll('.sbk-card[data-sid]').forEach(function(el){
      el.onclick=function(){
        var sid=parseInt(el.getAttribute('data-sid'));
        state.selService=state.services.find(function(s){return s.id===sid});
        if(!state.selService){
          state.selService=state.uncategorized.find(function(s){return s.id===sid});
        }
        state.selAddons=[];
        calcTotal();
        var addons=getAddonsForService(state.selService.id);
        if(addons.length>0){
          goStep('addons');
        }else{
          goStep('datetime');
        }
      };
    });

    // Addon checkboxes
    content.querySelectorAll('.sbk-addon-check').forEach(function(el){
      el.onchange=function(){
        var aid=parseInt(el.getAttribute('data-addonid'));
        var addon=state.services.find(function(s){return s.id===aid});
        if(!addon)return;
        if(el.checked){
          state.selAddons.push(addon);
        }else{
          state.selAddons=state.selAddons.filter(function(a){return a.id!==aid});
        }
        calcTotal();
        // Update total display without full re-render
        var totalBar=content.querySelector('.sbk-total-bar');
        if(totalBar){
          var priceEl=totalBar.querySelector('span[style*="font-size:20px"]');
          if(priceEl)priceEl.textContent='$'+state.totalPrice.toFixed(2);
        }
      };
    });

    // Calendar nav arrows
    content.querySelectorAll('[data-caldir]').forEach(function(el){
      el.onclick=function(){
        var dir=parseInt(el.getAttribute('data-caldir'));
        state.calMonth+=dir;
        if(state.calMonth>11){state.calMonth=0;state.calYear++}
        if(state.calMonth<0){state.calMonth=11;state.calYear--}
        render();
      };
    });

    // Calendar date clicks
    content.querySelectorAll('[data-caldate]').forEach(function(el){
      el.onclick=function(){
        state.selDate=el.getAttribute('data-caldate');
        state.selTime='';
        loadSlots();
      };
    });

    // Time slots
    content.querySelectorAll('.sbk-slot').forEach(function(el){
      el.onclick=function(){state.selTime=el.getAttribute('data-time');render()};
    });

    // Go next
    content.querySelectorAll('[data-gonext]').forEach(function(el){
      el.onclick=function(){goStep(el.getAttribute('data-gonext'))};
    });

    // Go back
    content.querySelectorAll('[data-goback]').forEach(function(el){
      el.onclick=function(){
        var p=getPrevStep();
        if(p)goStep(p);
      };
    });

    // Input fields
    content.querySelectorAll('[data-field]').forEach(function(el){
      el.oninput=function(){state.cust[el.getAttribute('data-field')]=el.value};
    });

    // Submit button (no payment)
    var submitEl=document.getElementById('sbk-submit');
    if(submitEl)submitEl.onclick=submit;

    // To payment button
    var toPayEl=document.getElementById('sbk-to-payment');
    if(toPayEl)toPayEl.onclick=function(){
      var c=state.cust;
      if(!c.name||!c.email||!c.phone){state.error='Please fill in all required fields';render();return}
      goStep('payment');
      setupPayment();
    };

    // Pay button
    var payEl=document.getElementById('sbk-pay');
    if(payEl)payEl.onclick=confirmPayment;
  }

  function esc(s){return(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function fmtDate(d){if(!d)return'';var p=d.split('-');return new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric',year:'numeric'})}
})();
</script>
`;
}

module.exports = { generateBookingWidgetCode };
