const state={category:'add-subtract',count:20,index:0,score:0,questions:[],mistakes:[],startedAt:0,timerId:null,elapsed:0,acceptingAnswer:false};
const $=selector=>document.querySelector(selector);
const setup=$('#setupPanel'),quiz=$('#quizPanel'),result=$('#resultPanel');
const clientKey='little-mental-math-client-id';
const summerDeadline=new Date(2026,7,31,23,59,59);
const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
let recognition=null;

document.querySelectorAll('.choice').forEach(button=>button.addEventListener('click',()=>{
  document.querySelectorAll('.choice').forEach(item=>item.classList.remove('selected'));
  button.classList.add('selected');state.category=button.dataset.operation;
}));

function rand(min,max){return Math.floor(Math.random()*(max-min+1))+min}
function question(a,b,answer,symbol,tip=''){return{a,b,answer,symbol,tip,text:`${a} ${symbol} ${b} = ?`}}
function makeAddSubtract(){
  if(Math.random()<.5){
    for(let tries=0;tries<100;tries++){const a=rand(12,89),b=rand(11,100-a);if((a%10)+(b%10)>=10)return question(a,b,a+b,'＋','个位凑 10，再往十位进 1');}
    return question(58,27,85,'＋','个位凑 10，再往十位进 1');
  }
  for(let tries=0;tries<100;tries++){const a=rand(21,99),b=rand(11,a-1);if(a%10<b%10)return question(a,b,a-b,'−','个位不够减，要向十位借 1');}
  return question(72,38,34,'−','个位不够减，要向十位借 1');
}
function makeMultiplyDivide(){
  if(Math.random()<.5){const a=rand(2,10),b=rand(2,10);return question(a,b,a*b,'×');}
  const b=rand(2,10),answer=rand(2,10);return question(b*answer,b,answer,'÷');
}
function makeSmart(){
  const kind=rand(0,3);
  if(kind===0){const a=rand(2,9)*10+rand(1,9),b=10-a%10;return question(a,b,a+b,'＋','先把个位凑成 10');}
  if(kind===1){const a=rand(21,89);return question(a,100-a,100,'＋','把两个数凑成 100');}
  const patterns=[[25,4,100,'×','25 × 4 = 100'],[125,8,1000,'×','125 × 8 = 1000'],[25,12,300,'×','先算 25 × 4，再乘 3'],[25,16,400,'×','先算 25 × 4，再乘 4'],[100,25,4,'÷','100 ÷ 25 = 4'],[1000,125,8,'÷','1000 ÷ 125 = 8'],[300,25,12,'÷','300 ÷ 25 = 12'],[400,25,16,'÷','400 ÷ 25 = 16']];
  const [a,b,answer,symbol,tip]=patterns[rand(0,patterns.length-1)];return question(a,b,answer,symbol,tip);
}
function makeQuestion(){if(state.category==='multiply-divide')return makeMultiplyDivide();if(state.category==='smart')return makeSmart();return makeAddSubtract();}
function formatTime(seconds){return `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}`}
function localDate(){const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`}
function deviceId(){let id=localStorage.getItem(clientKey);if(!id){id=crypto.randomUUID();localStorage.setItem(clientKey,id)}return id}
function formatDay(date){const [,month,day]=date.split('-');return `${Number(month)} 月 ${Number(day)} 日`}
function scoreOf(day){return Number(day.score??Math.round(Number(day.correct)/Number(day.total)*100))}
function sessionsOf(day){return Number(day.sessions??1)}
function speedOf(day){return Number(day.speed??(Number(day.elapsed)>0?Number(day.total)*60/Number(day.elapsed):0))}
function formatSpeed(value){return value>0?`${value.toFixed(1)} 题/分`:'—'}

function updateGoal(today){
  const sessions=today?sessionsOf(today):0,score=today?scoreOf(today):null,remaining=Math.max(0,Math.ceil((summerDeadline-Date.now())/86400000));
  $('#goalCountdown').textContent=remaining?`距离放假结束还有 ${remaining} 天`:'暑期目标已到期';
  $('#todayCount').textContent=sessions;$('#todayScore').textContent=score===null?'—':score;$('#goalProgressBar').style.width=`${Math.min(100,sessions/2*100)}%`;
  $('#goalProgressText').textContent=sessions>=2?'今天的 2 次打卡已完成，保持这个节奏！':sessions?`今天已完成 ${sessions}/2 次，再完成 ${2-sessions} 次即可达标。`:'今天还没有完成打卡，先开始第一组吧！';
}
function drawSpeedChart(days){
  const canvas=$('#speedChart'),ctx=canvas.getContext('2d'),points=days.slice(0,14).reverse().map(day=>({date:day.date,value:speedOf(day)})).filter(point=>point.value>0);
  const width=Math.max(260,canvas.clientWidth||560),height=130,dpr=window.devicePixelRatio||1;canvas.width=width*dpr;canvas.height=height*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,width,height);
  if(!points.length){ctx.fillStyle='#9aa6b8';ctx.font='12px Nunito, sans-serif';ctx.fillText('完成练习后，这里会画出你的口算速度曲线。',12,68);return;}
  const pad={left:12,right:12,top:14,bottom:24},values=points.map(point=>point.value),min=Math.max(0,Math.min(...values)-1),max=Math.max(...values)+1,range=Math.max(1,max-min);
  ctx.strokeStyle='#dfeafb';ctx.lineWidth=1;ctx.setLineDash([3,4]);for(let i=0;i<3;i++){const y=pad.top+i*(height-pad.top-pad.bottom)/2;ctx.beginPath();ctx.moveTo(pad.left,y);ctx.lineTo(width-pad.right,y);ctx.stroke();}ctx.setLineDash([]);
  const pointX=index=>points.length===1?width/2:pad.left+index*(width-pad.left-pad.right)/(points.length-1),pointY=value=>pad.top+(max-value)/range*(height-pad.top-pad.bottom);
  ctx.beginPath();points.forEach((point,index)=>{const x=pointX(index),y=pointY(point.value);index?ctx.lineTo(x,y):ctx.moveTo(x,y)});ctx.strokeStyle='#ff9770';ctx.lineWidth=3;ctx.lineCap='round';ctx.stroke();
  points.forEach((point,index)=>{ctx.beginPath();ctx.arc(pointX(index),pointY(point.value),4,0,Math.PI*2);ctx.fillStyle='#fff';ctx.fill();ctx.lineWidth=2;ctx.strokeStyle='#ff9770';ctx.stroke();});
  ctx.fillStyle='#94a0b2';ctx.font='10px Nunito, sans-serif';ctx.fillText(formatDay(points[0].date),pad.left,height-6);if(points.length>1){const label=formatDay(points.at(-1).date);ctx.fillText(label,width-pad.right-ctx.measureText(label).width,height-6);}
}
function updateHistory(days=[]){
  const today=days.find(day=>day.date===localDate()),recent=days.slice(0,7),weekTotal=recent.reduce((sum,day)=>sum+Number(day.total),0);
  $('#todaySummary').textContent=today?`${today.total} 题 · ${sessionsOf(today)} 次`:'还未练习';$('#weekSummary').textContent=weekTotal?`${weekTotal} 题`:'0 题';updateGoal(today);drawSpeedChart(days);
  const speedDays=days.slice(0,14).reverse().filter(day=>speedOf(day)>0),latest=speedDays.at(-1),previous=speedDays.at(-2);
  $('#speedTrend').textContent=latest?formatSpeed(speedOf(latest)):'暂无数据';$('#speedChange').textContent=latest&&previous?`比上次 ${speedOf(latest)-speedOf(previous)>=0?'+':''}${(speedOf(latest)-speedOf(previous)).toFixed(1)} 题/分`:'完成不同日期的练习后，会看到速度变化';
  $('#historyList').innerHTML=days.length?recent.map(day=>{const score=scoreOf(day);return `<div class="history-day"><span class="history-date">${formatDay(day.date)}</span><span class="history-detail">${sessionsOf(day)} 次打卡 · ${day.total} 题 · ${formatSpeed(speedOf(day))}</span><strong class="history-rate ${score<70?'needs-practice':''}">${score} 分</strong></div>`}).join(''):'<p class="history-empty">完成第一组练习后，这里会留下每天的学习足迹和速度变化。</p>';
}
async function loadHistory(){try{const response=await fetch(`/api/history?clientId=${encodeURIComponent(deviceId())}`);if(!response.ok)throw new Error('history unavailable');const data=await response.json();updateHistory(data.days||[])}catch{updateGoal();$('#todaySummary').textContent='暂未同步';$('#weekSummary').textContent='—';$('#historyList').innerHTML='<p class="history-empty">学习档案正在准备中，稍后再试即可。</p>';drawSpeedChart([])}}
async function saveSession(){try{await fetch('/api/history',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({clientId:deviceId(),date:localDate(),total:state.count,correct:state.score,elapsed:state.elapsed,mistakes:state.mistakes.length})});await loadHistory()}catch{}}
function start(){state.count=Number($('#questionCount').value);state.index=0;state.score=0;state.mistakes=[];state.questions=Array.from({length:state.count},makeQuestion);state.startedAt=Date.now();state.elapsed=0;state.acceptingAnswer=false;clearInterval(state.timerId);state.timerId=setInterval(()=>{$('#timer').textContent=formatTime(Math.floor((Date.now()-state.startedAt)/1000))},1000);setup.classList.add('hidden');result.classList.add('hidden');quiz.classList.remove('hidden');showQuestion()}
function setVoiceStatus(text,type=''){$('#voiceStatus').textContent=text;$('#voiceStatus').className=('voice-status '+type).trim()}
function setVoiceButton(listening=false){const button=$('#voiceButton');button.classList.toggle('listening',listening);button.disabled=state.acceptingAnswer;$('#voiceButtonText').textContent=listening?'正在听，请说答案…':'点击话筒开始说'}
function parseSpokenNumber(transcript){const text=String(transcript).replace(/[，。！？、\\s]/g,'');const arabic=text.match(/-?\\d+/);if(arabic)return Number(arabic[0]);const matches=text.match(/[零〇一二两三四五六七八九十百千]+/g);if(!matches)return NaN;const words=matches.sort((a,b)=>b.length-a.length)[0],digits={零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};if([...words].every(char=>Object.prototype.hasOwnProperty.call(digits,char)))return Number([...words].map(char=>digits[char]).join(''));const units={十:10,百:100,千:1000};let total=0,current=0;for(const char of words){if(Object.prototype.hasOwnProperty.call(digits,char))current=digits[char];else if(units[char]){total+=(current||1)*units[char];current=0}}return total+current}
function prepareRecognition(){if(!Recognition)return null;if(recognition)return recognition;recognition=new Recognition();recognition.lang='zh-CN';recognition.continuous=false;recognition.interimResults=false;recognition.maxAlternatives=1;recognition.onstart=()=>{setVoiceButton(true);setVoiceStatus('正在听，请直接说出答案…')};recognition.onresult=event=>{const words=event.results[0][0].transcript,answer=parseSpokenNumber(words);if(Number.isNaN(answer)){setVoiceStatus('没有听清“'+words+'”，请再说一次。','error');return}setVoiceStatus('识别到：'+answer,'success');gradeAnswer(answer)};recognition.onerror=event=>{setVoiceStatus(event.error==='not-allowed'?'请允许浏览器使用麦克风后再试。':event.error==='no-speech'?'没有听到声音，请再试一次。':'语音识别暂时不可用，请再试一次。','error')};recognition.onend=()=>{if(!state.acceptingAnswer)setVoiceButton(false)};return recognition}
function startListening(){if(state.acceptingAnswer)return;const listener=prepareRecognition();if(!listener){setVoiceStatus('当前浏览器不支持语音识别，请使用最新版 Chrome 或 Edge。','error');return}try{listener.start()}catch{setVoiceStatus('请稍等一下，再点击话筒说答案。','error')}}
function showQuestion(){const q=state.questions[state.index];$('#progressText').textContent=`第 ${state.index+1} / ${state.count} 题`;$('#progressBar').style.width=`${state.index/state.count*100}%`;$('#questionText').textContent=q.text;$('#feedback').textContent='';$('#feedback').className='feedback';$('#answerInput').value='';$('#answerInput').focus();state.acceptingAnswer=false;setVoiceButton(false);setVoiceStatus('支持中文数字或阿拉伯数字。')}
function submitTyped(event){event.preventDefault();if(state.acceptingAnswer)return;const input=$('#answerInput');if(input.value.trim()===''){input.focus();return;}gradeAnswer(Number(input.value));}
function gradeAnswer(answer){if(state.acceptingAnswer)return;state.acceptingAnswer=true;const q=state.questions[state.index],feedback=$('#feedback');setVoiceButton(false);if(answer===q.answer){state.score++;feedback.textContent='回答正确！继续保持 ✦'+(q.tip?' · '+q.tip:'');feedback.classList.add('good')}else{feedback.textContent='正确答案是 '+q.answer+(q.tip?' · 技巧：'+q.tip:'');feedback.classList.add('bad');state.mistakes.push({q,answer})}setTimeout(()=>{if(state.index<state.count-1){state.index++;showQuestion()}else finish()},800)}
function finish(){clearInterval(state.timerId);state.elapsed=Math.floor((Date.now()-state.startedAt)/1000);quiz.classList.add('hidden');result.classList.remove('hidden');const accuracy=Math.round(state.score/state.count*100);$('#scoreText').textContent=state.score;$('#totalText').textContent=state.count;$('#accuracyText').textContent=`${accuracy}%`;$('#timeText').textContent=formatTime(state.elapsed);$('#mistakeText').textContent=state.mistakes.length;$('#resultTitle').textContent=accuracy>=90?'太厉害了！':accuracy>=70?'做得不错！':'再练一组会更好！';$('#mistakeList').innerHTML=state.mistakes.map(({q,answer})=>`<div class="mistake-item"><span>${q.a} ${q.symbol} ${q.b} = ${answer}</span><span class="right">正确：${q.answer}</span></div>`).join('');saveSession()}
function goHome(){clearInterval(state.timerId);if(recognition){try{recognition.abort()}catch{}}result.classList.add('hidden');quiz.classList.add('hidden');setup.classList.remove('hidden')}
$('#startButton').addEventListener('click',start);$('#answerForm').addEventListener('submit',submitTyped);$('#voiceButton').addEventListener('click',startListening);$('#quitButton').addEventListener('click',goHome);$('#retryButton').addEventListener('click',start);$('#homeButton').addEventListener('click',goHome);loadHistory();