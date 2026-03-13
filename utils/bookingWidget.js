/**
 * Generates a self-contained booking widget (HTML+CSS+JS) that opens as a modal
 * when any `a[href="#book-online"]` link is clicked.
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
  .sbk-date-select{width:100%;padding:12px;border:2px solid #e5e7eb;border-radius:8px;font-size:15px;outline:none;margin-bottom:12px}
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
</style>
<script>
(function(){
  var API='${apiUrl}';
  var UID='${userId}';
  var overlay=document.getElementById('sorce-booking-overlay');
  var content=document.getElementById('sorce-booking-content');
  var state={step:1,services:[],hours:[],biz:null,selService:null,selDate:'',selTime:'',slots:[],loading:false,error:null,success:false,bookingNum:'',cust:{name:'',email:'',phone:'',notes:''}};

  function open(){overlay.classList.add('open');document.body.style.overflow='hidden';if(!state.services.length)loadData()}
  function close(){overlay.classList.remove('open');document.body.style.overflow=''}

  document.getElementById('sorce-booking-close').onclick=close;
  overlay.addEventListener('click',function(e){if(e.target===overlay)close()});

  // Intercept all #book-online links
  document.addEventListener('click',function(e){
    var a=e.target.closest('a[href="#book-online"],a[href="/booking"]');
    if(a){e.preventDefault();open()}
  });

  function loadData(){
    state.loading=true;render();
    Promise.all([
      fetch(API+'/api/public/services?businessId='+UID).then(function(r){return r.json()}),
      fetch(API+'/api/public/business-hours?businessId='+UID).then(function(r){return r.json()}),
      fetch(API+'/api/public/business-info?businessId='+UID).then(function(r){return r.json()})
    ]).then(function(res){
      state.services=res[0].services||[];
      state.hours=res[1].businessHours||[];
      state.biz=res[2].business||null;
      state.loading=false;render();
    }).catch(function(){state.loading=false;state.error='Failed to load booking info';render()});
  }

  function loadSlots(){
    if(!state.selDate||!state.selService)return;
    state.loading=true;state.selTime='';render();
    fetch(API+'/api/public/availability?businessId='+UID+'&serviceIds='+state.selService.id+'&date='+state.selDate)
      .then(function(r){return r.json()})
      .then(function(d){state.slots=d.slots||[];state.loading=false;render()})
      .catch(function(){state.loading=false;state.error='Failed to load times';render()});
  }

  function getAvailDates(){
    var dates=[];var now=new Date();
    for(var i=0;i<30;i++){
      var d=new Date(now);d.setDate(now.getDate()+i);
      var dow=d.getDay();
      var h=state.hours.find(function(x){return x.day_of_week===dow});
      if(h&&h.is_open)dates.push(d);
    }
    return dates;
  }

  function submit(){
    var c=state.cust;
    if(!c.name||!c.email||!c.phone){state.error='Please fill in all required fields';render();return}
    state.loading=true;state.error=null;render();
    fetch(API+'/api/public/bookings/create',{
      method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({businessId:UID,serviceId:state.selService.id,additionalServiceIds:[],bookingDate:state.selDate,startTime:state.selTime,customerInfo:{name:c.name,email:c.email,phone:c.phone},customerNotes:c.notes,assignmentType:'any'})
    }).then(function(r){return r.json()}).then(function(d){
      if(d.success){state.success=true;state.bookingNum=d.bookingNumber}else{state.error=d.error||'Booking failed'}
      state.loading=false;render();
    }).catch(function(){state.loading=false;state.error='Failed to submit booking';render()});
  }

  function render(){
    if(state.loading&&!state.services.length){content.innerHTML='<div class="sbk-loading"><div class="sbk-spin"></div>Loading...</div>';return}
    if(state.success){
      content.innerHTML='<div class="sbk-success"><div style="width:60px;height:60px;border-radius:50%;background:#d1fae5;display:flex;align-items:center;justify-content:center;margin:0 auto"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6L9 17l-5-5"/></svg></div><h3>Booking Confirmed!</h3><p style="color:#6b7280;margin:0 0 16px">Confirmation #'+state.bookingNum+'</p><div class="sbk-summary"><div class="sbk-summary-row"><span>Service</span><span>'+esc(state.selService.name)+'</span></div><div class="sbk-summary-row"><span>Date</span><span>'+fmtDate(state.selDate)+'</span></div><div class="sbk-summary-row"><span>Time</span><span>'+state.selTime+'</span></div><div class="sbk-summary-row"><span>Total</span><span>$'+parseFloat(state.selService.price).toFixed(2)+'</span></div></div><p style="font-size:14px;color:#6b7280">A confirmation email has been sent to '+esc(state.cust.email)+'</p><button class="sbk-btn" onclick="document.getElementById(\\'sorce-booking-overlay\\').classList.remove(\\'open\\');document.body.style.overflow=\\'\\'">Done</button></div>';
      return;
    }
    var h='';
    if(state.error)h+='<div class="sbk-error">'+esc(state.error)+'</div>';

    if(state.step===1){
      h+='<h3 class="sbk-title">'+(state.biz?esc(state.biz.business_name):'Book Online')+'</h3>';
      h+='<p class="sbk-sub">Select a service to get started</p>';
      if(!state.services.length)h+='<p style="color:#9ca3af;text-align:center;padding:20px">No services available yet.</p>';
      state.services.forEach(function(s){
        h+='<div class="sbk-card" data-sid="'+s.id+'"><h4>'+esc(s.name)+'</h4>'+(s.description?'<p>'+esc(s.description)+'</p>':'')+'<div class="sbk-row" style="margin-top:8px"><span class="sbk-price">$'+parseFloat(s.price).toFixed(2)+'</span><span class="sbk-dur">'+s.duration_hours+'h</span></div></div>';
      });
    } else if(state.step===2){
      h+='<button class="sbk-btn-back" data-back="1">&larr; Back</button>';
      h+='<h3 class="sbk-title">Choose Date & Time</h3>';
      h+='<div class="sbk-summary" style="padding:12px 14px;margin-bottom:14px"><div class="sbk-row"><span style="font-weight:600">'+esc(state.selService.name)+'</span><span class="sbk-price" style="font-size:16px">$'+parseFloat(state.selService.price).toFixed(2)+'</span></div></div>';
      h+='<label class="sbk-label">Select Date</label><select class="sbk-date-select" id="sbk-date"><option value="">Choose a date...</option>';
      getAvailDates().forEach(function(d){
        var ds=d.toISOString().split('T')[0];
        var dn=d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'});
        h+='<option value="'+ds+'"'+(state.selDate===ds?' selected':'')+'>'+dn+'</option>';
      });
      h+='</select>';
      if(state.selDate){
        h+='<label class="sbk-label">Select Time</label>';
        if(state.loading)h+='<div class="sbk-loading" style="padding:20px"><div class="sbk-spin"></div></div>';
        else if(state.slots.length){
          h+='<div class="sbk-slots">';
          state.slots.forEach(function(s){h+='<div class="sbk-slot'+(state.selTime===s.time?' sel':'')+'" data-time="'+s.time+'">'+s.displayTime+'</div>'});
          h+='</div>';
        }else h+='<p style="color:#9ca3af;font-size:14px">No available times for this date.</p>';
      }
      if(state.selDate&&state.selTime)h+='<button class="sbk-btn" data-next="3">Continue &rarr;</button>';
    } else if(state.step===3){
      h+='<button class="sbk-btn-back" data-back="2">&larr; Back</button>';
      h+='<h3 class="sbk-title">Your Information</h3>';
      h+='<div class="sbk-summary"><div class="sbk-summary-row"><span>Service</span><span>'+esc(state.selService.name)+'</span></div><div class="sbk-summary-row"><span>Date</span><span>'+fmtDate(state.selDate)+'</span></div><div class="sbk-summary-row"><span>Time</span><span>'+state.selTime+'</span></div><div class="sbk-summary-row" style="border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px"><span style="font-weight:700">Total</span><span class="sbk-price" style="font-size:18px">$'+parseFloat(state.selService.price).toFixed(2)+'</span></div></div>';
      h+='<label class="sbk-label">Full Name <span class="sbk-req">*</span></label><input class="sbk-input" data-field="name" value="'+esc(state.cust.name)+'" placeholder="John Doe">';
      h+='<label class="sbk-label">Email <span class="sbk-req">*</span></label><input class="sbk-input" data-field="email" type="email" value="'+esc(state.cust.email)+'" placeholder="john@example.com">';
      h+='<label class="sbk-label">Phone <span class="sbk-req">*</span></label><input class="sbk-input" data-field="phone" type="tel" value="'+esc(state.cust.phone)+'" placeholder="(555) 123-4567">';
      h+='<label class="sbk-label">Notes (Optional)</label><textarea class="sbk-input" data-field="notes" rows="2" placeholder="Anything we should know..." style="resize:vertical">'+esc(state.cust.notes)+'</textarea>';
      h+='<button class="sbk-btn" id="sbk-submit"'+(state.loading?' disabled':'')+'>'+( state.loading?'<span class="sbk-spin" style="width:18px;height:18px;border-width:2px;display:inline-block;vertical-align:middle;margin-right:8px"></span>Confirming...':'Confirm Booking')+'</button>';
      h+='<p style="text-align:center;font-size:12px;color:#9ca3af;margin-top:10px">You\'ll receive a confirmation email</p>';
    }
    content.innerHTML=h;

    // Bind events
    content.querySelectorAll('.sbk-card').forEach(function(el){
      el.onclick=function(){
        var sid=parseInt(el.getAttribute('data-sid'));
        state.selService=state.services.find(function(s){return s.id===sid});
        state.step=2;state.error=null;render();
      };
    });
    var dateEl=document.getElementById('sbk-date');
    if(dateEl)dateEl.onchange=function(){state.selDate=dateEl.value;state.selTime='';loadSlots()};
    content.querySelectorAll('.sbk-slot').forEach(function(el){
      el.onclick=function(){state.selTime=el.getAttribute('data-time');render()};
    });
    content.querySelectorAll('[data-next]').forEach(function(el){
      el.onclick=function(){state.step=parseInt(el.getAttribute('data-next'));state.error=null;render()};
    });
    content.querySelectorAll('[data-back]').forEach(function(el){
      el.onclick=function(){state.step=parseInt(el.getAttribute('data-back'));state.error=null;render()};
    });
    content.querySelectorAll('[data-field]').forEach(function(el){
      el.oninput=function(){state.cust[el.getAttribute('data-field')]=el.value};
    });
    var submitEl=document.getElementById('sbk-submit');
    if(submitEl)submitEl.onclick=submit;
  }

  function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  function fmtDate(d){if(!d)return'';var p=d.split('-');return new Date(p[0],p[1]-1,p[2]).toLocaleDateString('en-US',{weekday:'short',month:'long',day:'numeric',year:'numeric'})}
})();
</script>
`;
}

module.exports = { generateBookingWidgetCode };
