import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'framer-motion'
import { clearAuthUser, readAuthUser, type AuthUser } from '../../authApi'
import { DestinationPicker } from '../../components/DestinationPicker'
import { Header } from '../../components/Header'
import { Landing } from '../../components/Landing'
import { DestinationRequestModal, LoginModal, MarketingModal, ProfileModal } from '../../components/PrototypeModals'
import { copyText, shareTrip } from '../../exportUtils'
import { changedRerunDiff, demoResultForDestination, featuredDestinations, unchangedRerunDiff } from '../../product/mockData'
import type { LandingModal, ResultMode, Stage } from '../../types'
import { canReturnToStage, readDecisionIdFromUrl, readInitialResultMode, readInitialStage, readReplayNavigationState, readResultModeFromUrl, readStageFromUrl, writeNavigationState, type ReplayNavigationState } from '../../utils/navigation'
import { writeStorage } from '../../utils/storage'
import { DateResolutionScreen, PlanningScreen } from '../planning/PlanningScreens'
import { MeetingReplayPage } from '../replay/MeetingReplayPage'
import { DEMO_REPLAY_REQUEST } from '../replay/providers/mockReplayRepository'
import { DecisionDetail, ProductResults } from '../results/ProductResults'
import { InviteRoom, ProductLobby } from '../room/RoomScreens'
import { ReopenFlow, RerunProcessing, RerunResult } from '../rerun/RerunScreens'
import { TripBuilderSurvey } from '../survey/TripBuilderSurvey'
import { useProductFlow } from './useProductFlow'

export function MoaProductFlow(){
  const [stage,setStage]=useState<Stage>(readInitialStage)
  const [mode,setMode]=useState<ResultMode>(readInitialResultMode)
  const [landingModal,setLandingModal]=useState<LandingModal>(null)
  const [profileOpen,setProfileOpen]=useState(false)
  const [requestOpen,setRequestOpen]=useState(false)
  const [authUser,setAuthUser]=useState<AuthUser|null>(readAuthUser)
  const [toast,setToast]=useState('')
  const navigationInitialized=useRef(false)
  const initialDecisionId=useRef(readDecisionIdFromUrl())
  const resultsUnderlayRef=useRef<HTMLDivElement>(null)
  const {state,dispatch}=useProductFlow(initialDecisionId.current)

  useEffect(()=>{writeStorage('local','moa-stage',stage)},[stage])
  useEffect(()=>{if(navigationInitialized.current)return;writeNavigationState(stage,mode,'replace',readReplayNavigationState()??undefined,state.selectedDecisionId);navigationInitialized.current=true},[mode,stage,state.selectedDecisionId])
  useEffect(()=>{const onPop=()=>{const nextDecisionId=readDecisionIdFromUrl();if(nextDecisionId)dispatch({type:'decision',id:nextDecisionId});setStage(readStageFromUrl()??'landing');setMode(readResultModeFromUrl()??'overview')};window.addEventListener('popstate',onPop);return()=>window.removeEventListener('popstate',onPop)},[dispatch])
  useEffect(()=>{if(resultsUnderlayRef.current)resultsUnderlayRef.current.inert=stage==='decision'},[stage])
  useEffect(()=>{if(!toast)return;const timer=window.setTimeout(()=>setToast(''),2200);return()=>window.clearTimeout(timer)},[toast])

  const openPhoneDemo=useCallback(()=>{const url=new URL(window.location.href);url.searchParams.set('presentation','phone');url.searchParams.delete('embedded');url.searchParams.set('stage','landing');url.searchParams.delete('mode');url.searchParams.delete('decisionId');window.location.assign(url)},[])
  const go=useCallback((next:Stage,replay?:ReplayNavigationState)=>{if(next==='reopen')dispatch({type:'reset-reopen'});writeNavigationState(next,mode,'push',replay,state.selectedDecisionId);setStage(next);if(next!=='decision')window.scrollTo({top:0,behavior:'smooth'})},[dispatch,mode,state.selectedDecisionId])
  const changeMode=useCallback((next:ResultMode)=>{setMode(next);writeNavigationState('result',next,'replace')},[])
  const returnOrReplace=useCallback((current:Stage,returnStages:Stage|Stage[],fallback:Stage)=>{if(canReturnToStage(current,returnStages)){window.history.back();return}writeNavigationState(fallback,mode,'replace',undefined,state.selectedDecisionId);setStage(fallback)},[mode,state.selectedDecisionId])
  const closeDecision=useCallback(()=>returnOrReplace('decision','result','result'),[returnOrReplace])
  const returnFromReopen=useCallback(()=>returnOrReplace('reopen','decision','decision'),[returnOrReplace])
  const returnFromReplay=useCallback(()=>returnOrReplace('replay',['result','decision'],'result'),[returnOrReplace])
  const inviteUrl=`${window.location.origin}/?stage=lobby`
  const copyInvite=async()=>{try{await copyText(inviteUrl);setToast('데모 초대 링크를 복사했어요')}catch{setToast('링크를 복사하지 못했어요')}}
  const shareInvite=async()=>{try{const result=await shareTrip(inviteUrl);setToast(result==='shared'?'공유 화면을 열었어요':'링크를 복사했어요')}catch{setToast('공유를 취소했어요')}}
  const productResult=demoResultForDestination(state.destination)
  const selectedDecision=productResult.decisions.find((item)=>item.id===state.selectedDecisionId)??productResult.decisions[0]
  const pace=productResult.pace
  const replayLocation=readReplayNavigationState()
  const replayRequest=replayLocation?{tripId:replayLocation.tripId,planVersionId:replayLocation.planVersionId,decisionId:replayLocation.decisionId}:{...DEMO_REPLAY_REQUEST,decisionId:selectedDecision.id}
  const initialReplayRoundId=replayLocation?.roundId??'round-r2'
  const openReplay=()=>go('replay',{...replayRequest,roundId:initialReplayRoundId})
  const updateReplayRound=(roundId:string)=>writeNavigationState('replay',mode,'replace',{...replayRequest,roundId})
  const openDecision=useCallback((id:string,next:'decision'|'reopen')=>{dispatch({type:'decision',id});writeNavigationState(next,mode,'push',undefined,id);setStage(next);if(next!=='decision')window.scrollTo({top:0,behavior:'smooth'})},[dispatch,mode])
  const finishSurvey=()=>go('date-resolution')

  const resultsWorkspace=<div ref={resultsUnderlayRef} className="moa-results-underlay" aria-hidden={stage==='decision'?true:undefined}><ProductResults result={productResult} pace={pace} mode={mode} setMode={changeMode} back={()=>go('lobby')} decision={(id)=>openDecision(id,'decision')} reopen={(id)=>openDecision(id,'reopen')} selectedDecisionId={selectedDecision.id} selectDecision={(id)=>dispatch({type:'decision',id})}/></div>

  const screen=(()=>{switch(stage){
    case 'landing':return <Landing create={()=>go('destinations')} join={()=>go('lobby')} intro={()=>setLandingModal('intro')} how={()=>setLandingModal('how')} phoneDemo={openPhoneDemo} signedIn={Boolean(authUser)} userInitial={authUser?.name.trim().charAt(0)||''} login={()=>authUser?setProfileOpen(true):setLandingModal('login')}/>
    case 'destinations':return <DestinationPicker destinations={featuredDestinations} selected={state.destination} select={(value)=>dispatch({type:'destination',value})} next={()=>go('invite')} request={()=>setRequestOpen(true)}/>
    case 'invite':return <InviteRoom destination={state.destination} copy={copyInvite} share={shareInvite} next={()=>go('lobby')}/>
    case 'lobby':return <ProductLobby destination={state.destination} start={()=>go('survey')} copy={copyInvite}/>
    case 'survey':return <TripBuilderSurvey destination={state.destination} backToRoom={()=>go('lobby')} complete={finishSurvey}/>
    case 'date-resolution':return <DateResolutionScreen back={()=>go('lobby')} next={()=>go('planning')}/>
    case 'planning':return <PlanningScreen leave={()=>go('lobby')} next={()=>go('result')}/>
    case 'result':case 'decision':return resultsWorkspace
    case 'reopen':return <ReopenFlow decision={selectedDecision} reason={state.reopenReason} choice={state.reopenChoice} applyFuture={state.applyToFutureTrips} setReason={(value)=>dispatch({type:'reopen-reason',value})} setChoice={(value)=>dispatch({type:'reopen-choice',value})} setApplyFuture={(value)=>dispatch({type:'apply-future',value})} back={returnFromReopen} start={()=>go('rerun-processing')}/>
    case 'rerun-processing':return <RerunProcessing decision={selectedDecision} leave={()=>go('result')} next={()=>go('updated-result')}/>
    case 'updated-result':return <RerunResult diff={state.reopenReason==='incorrect-fact'?unchangedRerunDiff:changedRerunDiff} evidence={()=>go('decision')} back={()=>go('result')}/>
    case 'replay':return <MeetingReplayPage request={replayRequest} initialRoundId={initialReplayRoundId} back={returnFromReplay} roundChanged={updateReplayRound}/>
  }})()

  const resultsStage=['result','decision','reopen','updated-result'].includes(stage)
  const screenKey=stage==='result'||stage==='decision'?'results':stage
  return <div className={`moa-app${resultsStage?' moa-results-active':''}`}>{stage!=='landing'&&!resultsStage&&stage!=='replay'&&stage!=='survey'&&<Header stage={stage} destinationLabel={`${state.destination.name} 여행`} home={()=>go('landing')} room={()=>go('lobby')} profile={()=>authUser?setProfileOpen(true):setLandingModal('login')} userInitial={authUser?.name.trim().charAt(0)||'F'}/>}<AnimatePresence mode="wait"><motion.main key={screenKey} initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:.2}}>{screen}</motion.main></AnimatePresence>{stage==='decision'&&<DecisionDetail decision={selectedDecision} back={closeDecision} reopen={()=>go('reopen')} replay={openReplay} mobileSheet={mode==='decisions'}/>}<AnimatePresence>{landingModal==='intro'||landingModal==='how'?<MarketingModal kind={landingModal} close={()=>setLandingModal(null)}/>:null}</AnimatePresence><AnimatePresence>{landingModal==='login'&&<LoginModal close={()=>setLandingModal(null)} authenticated={(user)=>{setAuthUser(user);setLandingModal(null);go('destinations')}}/>}</AnimatePresence><AnimatePresence>{profileOpen&&authUser&&<ProfileModal user={authUser} close={()=>setProfileOpen(false)} logout={()=>{clearAuthUser();setAuthUser(null);setProfileOpen(false);go('landing')}}/>}</AnimatePresence><AnimatePresence>{requestOpen&&<DestinationRequestModal close={()=>setRequestOpen(false)} submitted={(destination)=>{setRequestOpen(false);setToast(`${destination} 지원 요청을 저장했어요`)}}/>}</AnimatePresence><AnimatePresence>{toast&&<motion.div className="moa-toast" role="status" aria-live="polite" initial={{opacity:0,y:16}} animate={{opacity:1,y:0}} exit={{opacity:0}}><CheckCircle weight="fill"/>{toast}</motion.div>}</AnimatePresence></div>
}
