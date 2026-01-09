"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { createClient } from "@supabase/supabase-js";
import toast, { Toaster } from "react-hot-toast"; 
import { toPng } from "html-to-image"; 
import { formatDistanceToNow } from 'date-fns';
import { ko } from 'date-fns/locale';

// --- [Supabase 설정] ---
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

// --- [데이터 상수] ---
const BRANDS: any = {
  all: { name: "All", koreanName: "전체", color: "#111827" }, 
  bbq: { name: "BBQ", koreanName: "비비큐", color: "#A50034" },
  bhc: { name: "BHC", koreanName: "BHC", color: "#F58220" },
  kyochon: { name: "Kyochon", koreanName: "교촌", color: "#C0985D" },
  goobne: { name: "Goobne", koreanName: "굽네", color: "#D12732" },
  nene: { name: "Nene", koreanName: "네네", color: "#F6C60D" },
  norangtongdak: { name: "Norang", koreanName: "노랑통닭", color: "#FFD200" },
  mexicana: { name: "Mexicana", koreanName: "멕시카나", color: "#CE1F2C" },
  gcova: { name: "Zicoba", koreanName: "지코바", color: "#C8161D" },
  cheogajip: { name: "Cheogajip", koreanName: "처갓집", color: "#E30412" },
  pelicana: { name: "Pelicana", koreanName: "페리카나", color: "#D60018" },
  puradakchicken: { name: "Puradak", koreanName: "푸라닭", color: "#000000" }
};

const PART_TO_KR: Record<string, string> = {
    "Whole": "한마리", "Whole chicken": "한마리",
    "Boneless": "순살", "Drumsticks": "닭다리", "Leg": "다리",
    "Wings": "날개", "Wing": "날개", "Combo": "콤보",
    "Wings & drumettes": "윙&봉", "Wing combo": "윙콤보",
    "Stick": "스틱", "Single Menu": "기본"
};

const REVIEW_TAGS = ["👍 Crispy", "🔥 Spicy", "🍺 Good with Beer", "🍚 Good with Rice", "🍯 Sweet", "🧀 Cheesy"];

// --- [유틸리티 함수] ---
function normalizeBaseName(raw: string) {
  return raw.trim().replace(/[,\s]+$/g, "").normalize("NFC");
}

function fnv1a32x2Hex(input: string) {
  const data = new TextEncoder().encode(input);
  let h1 = 0x811c9dc5;
  for (const b of data) { h1 ^= b; h1 = Math.imul(h1, 0x01000193); h1 >>>= 0; }
  const data2 = new TextEncoder().encode(input + "\u0000");
  let h2 = 0x811c9dc5;
  for (const b of data2) { h2 ^= b; h2 = Math.imul(h2, 0x01000193); h2 >>>= 0; }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

function getBrandPossibleKeys(englishKey: string, koreanName: string) {
    const keys = [];
    keys.push(`brand_${englishKey}.svg`); 
    if (koreanName) {
        const cleanName = normalizeBaseName(koreanName);
        const hash = fnv1a32x2Hex(cleanName);
        keys.push(`brand_${hash}.svg`);
    }
    return keys;
}

function getMenuPossibleKeys(id: string, brandId: string) {
    const keys = [];
    const cleanId = id.trim().normalize("NFC");
    keys.push(fnv1a32x2Hex(cleanId));
    keys.push(fnv1a32x2Hex(cleanId.replace(/\s+/g, "")));
    keys.push(fnv1a32x2Hex(cleanId.replace(/[^a-zA-Z0-9가-힣]/g, "")));
    if (cleanId.includes("치킨")) {
        const noChicken = cleanId.replace("치킨", "").trim();
        keys.push(fnv1a32x2Hex(noChicken));
        keys.push(fnv1a32x2Hex(noChicken.replace(/_/g, "")));
    }
    const noBrand = cleanId.replace(new RegExp(`^${brandId}_?`, "i"), "");
    if (noBrand !== cleanId) {
        keys.push(fnv1a32x2Hex(noBrand));
        keys.push(fnv1a32x2Hex(noBrand.replace("치킨", "")));
    }
    return [...new Set(keys)];
}

function getPartEmoji(partName: string) {
  const lower = partName.toLowerCase();
  if (lower.includes("boneless") || lower.includes("순살")) return "🥩";
  if (lower.includes("drumstick") || lower.includes("leg") || lower.includes("다리")) return "🍗";
  if (lower.includes("wing") || lower.includes("윙")) return "👐";
  if (lower.includes("combo") || lower.includes("콤보")) return "🍱";
  if (lower.includes("whole") || lower.includes("한마리")) return "🐓";
  return "🍗";
}

function getKoreanPartName(partName: string) {
    const cleanName = partName.trim();
    return PART_TO_KR[cleanName] || PART_TO_KR[Object.keys(PART_TO_KR).find(k => cleanName.includes(k)) || ""] || cleanName;
}

// --- [Physics Scroll Component] ---
interface ScrollableRowProps {
    children: React.ReactNode;
    className?: string;
    paddingClass?: string;
    showArrows?: boolean; 
    arrowYClass?: string; 
    arrowLeftClass?: string; 
    arrowRightClass?: string; 
}

const ScrollableRow = ({
    children,
    className = "",
    paddingClass = "px-5",
    showArrows = true,
    arrowYClass = "top-0 bottom-0 items-center",
    arrowLeftClass = "left-0.5",
    arrowRightClass = "right-0.5"
}: ScrollableRowProps) => {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const [showLeft, setShowLeft] = useState(false);
    const [showRight, setShowRight] = useState(false);
    
    // Physics State
    const state = useRef({
        isDragging: false,
        startX: 0,
        scrollLeft: 0,
        velocity: 0,
        lastTime: 0,
        bounceX: 0,
        rafId: 0,
        startMouseX: 0 
    });

    const checkArrows = () => {
        if (scrollRef.current) {
            const { scrollLeft, scrollWidth, clientWidth } = scrollRef.current;
            setShowLeft(scrollLeft > 5); 
            setShowRight(scrollLeft + clientWidth < scrollWidth - 5);
        }
    };

    useEffect(() => {
        checkArrows();
        window.addEventListener('resize', checkArrows);
        return () => window.removeEventListener('resize', checkArrows);
    }, [children]);

    const stopMomentum = () => {
        cancelAnimationFrame(state.current.rafId);
        state.current.velocity = 0;
    };

    const applyBounce = () => {
        if (!contentRef.current) return;
        contentRef.current.style.transform = `translateX(${state.current.bounceX}px)`;
    };

    const startBounceBack = () => {
        const step = () => {
            if (!state.current.isDragging) {
                state.current.bounceX *= 0.8;
                if (Math.abs(state.current.bounceX) < 0.5) state.current.bounceX = 0;
                applyBounce();
                if (state.current.bounceX !== 0) {
                    state.current.rafId = requestAnimationFrame(step);
                }
            }
        };
        step();
    };

    const startMomentum = () => {
        const step = () => {
            if (!scrollRef.current || state.current.isDragging) return;
            scrollRef.current.scrollLeft -= state.current.velocity;
            state.current.velocity *= 0.95;

            if (scrollRef.current.scrollLeft <= 0 && state.current.velocity > 0.5) {
                state.current.bounceX += state.current.velocity; 
                state.current.velocity = 0;
            } else if (scrollRef.current.scrollLeft >= (scrollRef.current.scrollWidth - scrollRef.current.clientWidth) && state.current.velocity < -0.5) {
                state.current.bounceX += state.current.velocity;
                state.current.velocity = 0;
            }
            
            if (state.current.bounceX !== 0) {
                 startBounceBack(); 
                 cancelAnimationFrame(state.current.rafId); 
                 return;
            }

            checkArrows();

            if (Math.abs(state.current.velocity) > 0.5) {
                state.current.rafId = requestAnimationFrame(step);
            }
        };
        step();
    };

    const onMouseDown = (e: React.MouseEvent) => {
        if (!scrollRef.current) return;
        state.current.isDragging = true;
        state.current.startX = e.pageX - scrollRef.current.offsetLeft;
        state.current.startMouseX = e.pageX; 
        state.current.scrollLeft = scrollRef.current.scrollLeft;
        state.current.lastTime = Date.now();
        state.current.velocity = 0;
        stopMomentum();
    };

    const onMouseMove = (e: React.MouseEvent) => {
        if (!state.current.isDragging || !scrollRef.current) return;
        
        if (Math.abs(e.pageX - state.current.startMouseX) < 5) return;

        e.preventDefault();
        const x = e.pageX - scrollRef.current.offsetLeft;
        const walk = (x - state.current.startX); 
        
        const now = Date.now();
        const dt = now - state.current.lastTime;
        if (dt > 0) {
            state.current.velocity = (walk - (state.current.scrollLeft - scrollRef.current.scrollLeft)) / dt * 8; 
        }
        state.current.lastTime = now;

        const maxScroll = scrollRef.current.scrollWidth - scrollRef.current.clientWidth;
        const targetScroll = state.current.scrollLeft - walk;

        if (targetScroll < 0) {
             state.current.bounceX = targetScroll * 0.4; 
             scrollRef.current.scrollLeft = 0;
        } else if (targetScroll > maxScroll) {
             state.current.bounceX = (targetScroll - maxScroll) * -0.4;
             scrollRef.current.scrollLeft = maxScroll;
        } else {
             state.current.bounceX = 0;
             scrollRef.current.scrollLeft = targetScroll;
        }
        applyBounce();
        checkArrows();
    };

    const onMouseUp = (e: React.MouseEvent) => {
        state.current.isDragging = false;
        if (Math.abs(e.pageX - state.current.startMouseX) < 5) return; 

        if (state.current.bounceX !== 0) {
            startBounceBack();
        } else {
            startMomentum();
        }
    };

    const scrollByArrow = (direction: 'left' | 'right') => {
        if (!scrollRef.current) return;
        const amount = scrollRef.current.clientWidth / 1.5;
        scrollRef.current.scrollBy({ left: direction === 'left' ? -amount : amount, behavior: 'smooth' });
        setTimeout(checkArrows, 300);
    };

    return (
        <div className="relative group w-full" onMouseLeave={onMouseUp} onMouseUp={onMouseUp} onMouseMove={onMouseMove}>
            <div className={`absolute ${arrowLeftClass} ${arrowYClass} z-20 flex justify-center transition-opacity duration-300 pointer-events-none ${showArrows && showLeft ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 hidden'}`}>
                <button 
                    onClick={(e) => { e.stopPropagation(); scrollByArrow('left'); }} 
                    className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-gray-500 hover:bg-white/40 hover:text-orange-600 transition-all pointer-events-auto active:scale-90 shadow-sm"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
                </button>
            </div>
            
            <div ref={scrollRef} onMouseDown={onMouseDown} className={`overflow-x-auto no-scrollbar cursor-grab active:cursor-grabbing w-full ${paddingClass}`} onScroll={checkArrows}>
                <div ref={contentRef} className={`transition-transform duration-75 ease-out w-max ${className}`}>
                    {children}
                </div>
            </div>

            <div className={`absolute ${arrowRightClass} ${arrowYClass} z-20 flex justify-center transition-opacity duration-300 pointer-events-none ${showArrows && showRight ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 hidden'}`}>
                <button 
                    onClick={(e) => { e.stopPropagation(); scrollByArrow('right'); }} 
                    className="w-8 h-8 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-gray-500 hover:bg-white/40 hover:text-orange-600 transition-all pointer-events-auto active:scale-90 shadow-sm"
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6"/></svg>
                </button>
            </div>
        </div>
    );
};

// --- [Components Outside Home] ---

const StarIcon = ({ fill }: { fill: number }) => (
  <div className="relative w-5 h-5 sm:w-6 sm:h-6 inline-block shrink-0">
    <svg className="w-full h-full text-gray-200 absolute top-0 left-0" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg>
    <div className="absolute top-0 left-0 h-full overflow-hidden" style={{ width: `${fill * 100}%` }}><svg className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-400" fill="currentColor" viewBox="0 0 24 24"><path d="M12 17.27L18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z" /></svg></div>
  </div>
);

const ChickenCardSkeleton = () => (
  <div className="bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 flex gap-4 animate-pulse">
    <div className="w-24 h-24 rounded-2xl bg-gray-200 flex-shrink-0"></div>
    <div className="flex-1 flex flex-col justify-center gap-3">
      <div className="h-4 bg-gray-200 rounded w-3/4"></div>
      <div className="h-3 bg-gray-200 rounded w-1/2"></div>
      <div className="h-8 bg-gray-200 rounded w-1/3 mt-2"></div>
    </div>
  </div>
);

const BrandIcon = ({ brandKey, isActive }: { brandKey: string, isActive: boolean }) => {
    const brand = BRANDS[brandKey];
    const [imgSrc, setImgSrc] = useState<string | null>(null);
    const [retryCount, setRetryCount] = useState(0);
    const possibleKeys = useMemo(() => getBrandPossibleKeys(brandKey, brand.koreanName), [brandKey, brand.koreanName]);

    useEffect(() => {
        setImgSrc(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chicken-images/${possibleKeys[0]}`);
        setRetryCount(0);
    }, [possibleKeys]);

    const handleError = () => {
        if (retryCount < possibleKeys.length - 1) {
            const nextKey = possibleKeys[retryCount + 1];
            setImgSrc(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chicken-images/${nextKey}`);
            setRetryCount(prev => prev + 1);
        } else {
            setImgSrc(null);
        }
    };

    if (!imgSrc) {
        return (
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center font-black text-xs text-white shadow-md transition-transform relative border border-gray-100 ${isActive ? 'scale-110 ring-2 ring-orange-500 shadow-lg shadow-orange-200 z-10' : ''}`} style={{ backgroundColor: brand.color }}>
                {brandKey === "all" ? "ALL" : brand.name.substring(0, 2).toUpperCase()}
            </div>
        );
    }

    return (
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center bg-white shadow-sm transition-transform relative border border-gray-100 ${isActive ? 'scale-110 ring-2 ring-orange-500 shadow-lg shadow-orange-200 z-10' : ''}`}>
            <div className="w-full h-full rounded-2xl overflow-hidden flex items-center justify-center">
                <img src={imgSrc} alt={brand.name} className="w-10 h-10 object-contain" onError={handleError} />
            </div>
        </div>
    );
};

const ChickenCard = ({ group, toggleFavorite, favorites, openModal }: any) => {
  const [selectedVariantIndex, setSelectedVariantIndex] = useState(0);
  const baseItem = group.variants[selectedVariantIndex];
  const parts = baseItem.tags && baseItem.tags.length > 0 ? baseItem.tags : ["Single Menu"];
  
  const ratingNum = typeof baseItem.avg_rating === "number" ? baseItem.avg_rating : parseFloat(String(baseItem.avg_rating ?? "0"));
  const displayRating = Number.isFinite(ratingNum) ? Number(ratingNum.toFixed(1)) : 0.0;
  const displayCount = Number(baseItem.review_count ?? 0) || 0;
  
  const isDragging = useRef(false);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const possibleKeys = useMemo(() => getMenuPossibleKeys(baseItem.id, baseItem.brand), [baseItem.id, baseItem.brand]);

  useEffect(() => {
    if (baseItem.image_url) setImgSrc(baseItem.image_url);
    else setImgSrc(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chicken-images/${possibleKeys[0]}.webp`);
    setRetryCount(0);
  }, [baseItem, possibleKeys]);

  const handleImgError = () => {
    if (retryCount < possibleKeys.length - 1) {
        const nextKey = possibleKeys[retryCount + 1];
        setImgSrc(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chicken-images/${nextKey}.webp`);
        setRetryCount(prev => prev + 1);
    } else {
        setImgSrc(null);
    }
  };

  return (
    <div className="group bg-white rounded-[24px] p-5 shadow-sm border border-gray-100 flex flex-col gap-4 relative transition-all duration-200 hover:shadow-xl hover:shadow-orange-500/5 active:scale-[0.98] cursor-pointer" onMouseDown={() => { isDragging.current = false; }} onMouseMove={() => { isDragging.current = true; }} onClick={() => { if(!isDragging.current) openModal(baseItem); }}>
      <button onClick={(e) => { e.stopPropagation(); toggleFavorite(baseItem.id); }} className="absolute top-4 right-4 z-10 p-2.5 rounded-full bg-white/90 hover:bg-gray-50 transition-colors shadow-sm text-lg active:scale-90 border border-gray-100">{favorites.includes(baseItem.id) ? "❤️" : "🤍"}</button>
      <div className="flex gap-5">
        <div className="w-28 h-28 rounded-2xl flex-shrink-0 overflow-hidden relative shadow-inner bg-gray-50">
          {imgSrc ? (<img src={imgSrc} alt={baseItem.name_en} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105" onError={handleImgError} />) : null}
          <div className={`w-full h-full flex flex-col items-center justify-center text-white font-bold text-[10px] text-center p-1 leading-tight ${imgSrc ? 'hidden' : ''}`} style={{ backgroundColor: BRANDS[baseItem.brand]?.color || "#000" }}><span className="opacity-80 uppercase tracking-wide mb-1">{BRANDS[baseItem.brand]?.name}</span><span className="bg-white/20 px-2 py-0.5 rounded text-[9px]">NO IMG</span></div>
        </div>
        <div className="flex-1 min-w-0 flex flex-col justify-between py-1">
          <div>
            <div className="flex items-center gap-1 mb-1.5"><span className="text-[10px] font-black text-white px-2 py-0.5 rounded-[6px] uppercase tracking-wider shadow-sm" style={{ backgroundColor: BRANDS[baseItem.brand]?.color || "#333" }}>{BRANDS[baseItem.brand]?.name || baseItem.brand}</span></div>
            <h3 className="font-bold text-gray-900 text-[17px] leading-snug line-clamp-1 group-hover:text-orange-600 transition-colors">{baseItem.name_en}</h3>
            <p className="text-xs text-gray-500 font-medium mt-0.5 line-clamp-1">{baseItem.name_kr}</p>
          </div>
          <div className="flex flex-col gap-1.5 mt-2">
             <div className="flex text-xs items-center gap-1.5">
               {baseItem.metrics.spicy > 0 ? (<div className="flex items-center bg-red-50 text-red-600 px-1.5 py-0.5 rounded-md border border-red-100"><span className="text-[10px] font-extrabold mr-1">SPICY</span><div className="flex text-[10px]">{[...Array(baseItem.metrics.spicy)].map((_, i) => <span key={i}>🌶️</span>)}</div></div>) : (<span className="text-[10px] font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded-md">Mild</span>)}
             </div>
             <div className="flex items-end gap-1"><span className="text-xl font-black text-gray-900 leading-none">₩{(baseItem.price / 1000).toFixed(0)}k</span><span className="text-xs text-gray-400 font-medium mb-0.5"> (≈ ${(baseItem.price / 1300).toFixed(1)})</span></div>
          </div>
        </div>
      </div>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pt-3 border-t border-dashed border-gray-100 gap-3" onClick={(e) => e.stopPropagation()}>
        <div className="w-full sm:w-auto max-w-[70%]">
             <ScrollableRow className="flex gap-1.5 pb-1" paddingClass="px-0" arrowLeftClass="left-0" arrowRightClass="right-0">
                {parts.map((partName: string, idx: number) => (
                    <span key={idx} className="px-2 py-1 rounded-lg bg-gray-50 text-gray-600 border border-gray-100 text-[10px] font-bold whitespace-nowrap flex-shrink-0"><span className="mr-1">{getPartEmoji(partName)}</span>{partName.trim()}</span>
                ))}
             </ScrollableRow>
        </div>
        <div className="flex items-center gap-1.5 self-end sm:self-auto bg-gray-50 px-2.5 py-1.5 rounded-xl border border-gray-100"><span className="text-yellow-400 text-sm">★</span><span className="text-sm font-bold text-gray-900">{displayRating}</span><span className="text-xs text-gray-400">({displayCount})</span></div>
      </div>
    </div>
  );
};

const DetailModal = ({ item, selectedPart, close, toggleFavorite, isFavorite, refreshData }: any) => {
  const [reviews, setReviews] = useState<any[]>([]);
  const [isFullScreenOrder, setIsFullScreenOrder] = useState(false);
  const [newRating, setNewRating] = useState(0);
  const [newComment, setNewComment] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const orderCardRef = useRef<HTMLDivElement>(null); 
  const parts = item.tags && item.tags.length > 0 ? item.tags : ["Whole Chicken"];
  const [currentPart, setCurrentPart] = useState<string>(selectedPart || parts[0]);
  const displayPartKr = getKoreanPartName(currentPart);
  const [imgSrc, setImgSrc] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const possibleKeys = useMemo(() => getMenuPossibleKeys(item.id, item.brand), [item.id, item.brand]);
  const isDragging = useRef(false);

  useEffect(() => {
    if (item.image_url) setImgSrc(item.image_url);
    else setImgSrc(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chicken-images/${possibleKeys[0]}.webp`);
    setRetryCount(0);
  }, [item, possibleKeys]);

  const handleImgError = () => {
    if (retryCount < possibleKeys.length - 1) {
        const nextKey = possibleKeys[retryCount + 1];
        setImgSrc(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/chicken-images/${nextKey}.webp`);
        setRetryCount(prev => prev + 1);
    } else {
        setImgSrc(null);
    }
  };

  const fetchReviews = useCallback(async () => {
    const { data, error } = await supabase.from('reviews').select('*').eq('menu_id', item.id).or('report_count.is.null,report_count.lt.5').order('created_at', { ascending: false });
    if (!error && data) setReviews(data);
  }, [item.id]);

  useEffect(() => { fetchReviews(); }, [fetchReviews]);
  const toggleTag = (tag: string) => setSelectedTags(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag]);
  
  const handleSubmit = async () => {
    if (newRating === 0) return toast.error("Please rate stars! ⭐");
    setIsSubmitting(true);
    const { error } = await supabase.from('reviews').insert({ menu_id: item.id, rating: newRating, content: newComment, password: newPassword || "0000", tags: selectedTags });
    if (error) { toast.error("Error: " + error.message); } else { toast.success("Review Saved! 🎉"); setNewRating(0); setNewComment(""); setNewPassword(""); setSelectedTags([]); await fetchReviews(); await refreshData(); }
    setIsSubmitting(false);
  };

  const handleReviewAction = async (reviewId: number, action: 'helpful' | 'report') => {
    const targetReview = reviews.find(r => r.id === reviewId); if(!targetReview) return;
    const column = action === 'helpful' ? 'helpful_count' : 'report_count';
    const newVal = (targetReview[column] || 0) + 1;
    setReviews(prev => prev.map(r => r.id === reviewId ? { ...r, [column]: newVal } : r));
    const { error } = await supabase.from('reviews').update({ [column]: newVal }).eq('id', reviewId);
    if(error) { toast.error("Action failed"); fetchReviews(); } else { if(action === 'helpful') toast.success("Marked as helpful!"); else toast("Reported.", { icon: '🚨' }); }
  };

  const saveOrderCard = async () => {
    if (!orderCardRef.current) return;
    try { const dataUrl = await toPng(orderCardRef.current, { cacheBust: true, backgroundColor: '#FFC107' }); const link = document.createElement('a'); link.download = `${item.name_en}_order_card.png`; link.href = dataUrl; link.click(); toast.success("Saved to Gallery! 📸"); } catch (err) { toast.error("Failed to save image."); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={close}></div>
      <div className="bg-white w-full max-w-md rounded-t-[32px] sm:rounded-[32px] p-6 z-10 relative animate-slide-up shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto">
        <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden"></div>
        <div className="relative">
          {imgSrc && (
            <div className="w-full h-64 rounded-[24px] overflow-hidden mb-6 shadow-lg relative bg-gray-50">
                <img src={imgSrc} alt={item.name_en} className="w-full h-full object-cover" onError={handleImgError} />
                <div className="absolute top-4 left-4"><span className="text-xs font-black text-white px-3 py-1.5 rounded-full uppercase tracking-wider shadow-md backdrop-blur-md" style={{ backgroundColor: BRANDS[item.brand]?.color || "#333" }}>{BRANDS[item.brand]?.name || item.brand}</span></div>
            </div>
          )}
          <div className="flex justify-between items-start mb-2">
            {!imgSrc && <div className="inline-block px-3 py-1 rounded-full text-[10px] font-black text-white uppercase tracking-wider shadow-md" style={{ backgroundColor: BRANDS[item.brand]?.color }}>{BRANDS[item.brand]?.name}</div>}
            <button onClick={() => toggleFavorite(item.id)} className="text-2xl active:scale-125 transition-transform ml-auto p-2 bg-gray-50 rounded-full hover:bg-gray-100">{isFavorite ? "❤️" : "🤍"}</button>
          </div>
          {item.metrics.spicy >= 4 && <div className="bg-red-50 border border-red-100 text-red-600 px-4 py-2.5 rounded-2xl text-xs font-bold mb-4 flex items-center gap-2 animate-pulse shadow-sm">⚠️ WARNING: Extremely Spicy! (Bul-dak Level)</div>}
          <h2 className="text-2xl font-black text-gray-900 leading-tight mb-1 pr-4">{item.name_en}</h2>
          <p className="text-lg text-gray-400 font-medium mb-4">{item.name_kr}</p>
          {item.desc_text && <div className="bg-gray-50 p-5 rounded-2xl mb-4 text-sm text-gray-600 leading-relaxed border border-gray-100"><span className="font-bold text-black block mb-1">Description</span>{item.desc_text}</div>}
          {item.allergens && <div className="bg-red-50 p-4 rounded-2xl mb-6 text-xs text-red-600 font-medium border border-red-100 flex gap-2 items-start"><span className="text-lg">⚠️</span><div><span className="font-bold uppercase block text-red-700">Allergy Info</span>{item.allergens}</div></div>}
          <div className="grid grid-cols-4 gap-2 mb-6">
            {[{l:"Spicy",v:item.metrics.spicy,i:"🌶️"},{l:"Crunch",v:item.metrics.crunch,i:"💥"},{l:"Sweet",v:item.metrics.sweet,i:"🍯"},{l:"Garlic",v:item.metrics.garlic,i:"🧄"}].map(m=>(<div key={m.l} className="bg-gray-50 rounded-2xl p-3 flex flex-col items-center justify-center gap-1 border border-gray-100"><span className="text-2xl mb-1">{m.i}</span><span className="text-[9px] font-bold text-gray-400 uppercase">{m.l}</span><div className="flex gap-0.5 mt-1">{[...Array(5)].map((_,i)=>(<div key={i} className={`w-1 h-2 rounded-full ${i<m.v?"bg-orange-500":"bg-gray-200"}`}></div>))}</div></div>))}
          </div>
          <div className="bg-orange-50 p-6 rounded-[24px] mb-4 border border-orange-100 relative overflow-hidden">
            <div className="absolute top-[-20px] right-[-20px] w-24 h-24 bg-orange-100 rounded-full opacity-50"></div>
            <div className="flex justify-between items-center mb-3 relative z-10"><p className="text-xs text-orange-600 font-bold uppercase tracking-wide">Order Card</p><button onClick={()=>setIsFullScreenOrder(true)} className="text-[10px] bg-white text-orange-600 px-3 py-1.5 rounded-lg font-bold hover:bg-orange-50 transition-colors shadow-sm">📱 Full Screen</button></div>
            <div className="text-xl font-bold text-gray-900 break-keep leading-snug relative z-10">"{BRANDS[item.brand]?.name} <span className="text-orange-600">{item.name_kr}</span><span className="block text-lg text-gray-700 mt-1">({displayPartKr})</span>주세요."</div>
            <p className="text-xs text-gray-400 mt-2 relative z-10">(Please give me this menu)</p>
          </div>
          
          <div onMouseDown={()=>isDragging.current=false} onMouseMove={()=>isDragging.current=true}>
            <ScrollableRow 
                className="flex gap-2 mb-8 py-2" 
                paddingClass="px-0" 
                arrowYClass="top-[1px] bottom-auto"
                arrowLeftClass="-left-2" 
                arrowRightClass="-right-2"
            >
                {parts.map((part: string) => (
                    <button key={part} onClick={(e) => { 
                        if(isDragging.current) return;
                        setCurrentPart(part); 
                    }} className={`px-4 py-2 rounded-xl text-xs font-bold transition-all border whitespace-nowrap flex-shrink-0 ${currentPart === part ? "bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-200 ring-2 ring-orange-200 ring-offset-1" : "bg-white text-gray-500 border-gray-200 hover:bg-gray-50 hover:text-gray-900"} active:scale-95`}><span className="mr-1.5 text-sm">{getPartEmoji(part)}</span>{part.trim()}</button>
                ))}
            </ScrollableRow>
          </div>

          <hr className="border-gray-100 mb-6" />
          <div className="mb-8">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Reviews & Rating</h3>
            <div className="bg-white p-5 rounded-[24px] border border-gray-100 mb-6 shadow-sm focus-within:ring-2 ring-orange-100 transition-all">
                <div className="text-xs font-bold text-gray-500 mb-3 uppercase tracking-wide">Leave a Review</div>
                <div className="flex justify-center mb-4 gap-2">{[1,2,3,4,5].map(idx=>{let fill=0;if(newRating>=idx)fill=1;else if(newRating>=idx-0.5)fill=0.5;return(<div key={idx} className="relative cursor-pointer w-8 h-8 group"><div className="w-full h-full text-gray-200 absolute"><StarIcon fill={0}/></div><div className="w-full h-full absolute text-yellow-400 transition-all duration-200"><StarIcon fill={fill}/></div><div className="absolute left-0 top-0 w-1/2 h-full z-10" onClick={()=>setNewRating(idx-0.5)}></div><div className="absolute right-0 top-0 w-1/2 h-full left-1/2 z-10" onClick={()=>setNewRating(idx)}></div></div>)})}</div>
                <div className="flex flex-wrap gap-2 mb-4 justify-center">{REVIEW_TAGS.map(tag => (<button key={tag} onClick={() => toggleTag(tag)} className={`px-3 py-1.5 rounded-xl text-[11px] font-bold border transition-all active:scale-95 ${selectedTags.includes(tag) ? "bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-200" : "bg-gray-50 text-gray-500 border-gray-200"}`}>{tag}</button>))}</div>
                <input type="text" placeholder="Short review (e.g. Best chicken ever!)" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 text-sm font-medium text-gray-900 placeholder:text-gray-400 mb-2 focus:outline-none focus:border-orange-500 focus:bg-white transition-colors" value={newComment} onChange={e=>setNewComment(e.target.value)}/>
                <input type="password" placeholder="Password (for deletion later)" className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3.5 text-xs font-medium text-gray-900 placeholder:text-gray-400 mb-3 focus:outline-none focus:border-orange-500 focus:bg-white transition-colors" value={newPassword} onChange={e=>setNewPassword(e.target.value)}/>
                <button onClick={handleSubmit} disabled={isSubmitting} className="w-full bg-gray-900 text-white font-bold py-4 rounded-xl text-sm hover:bg-black transition-all shadow-lg active:scale-95">{isSubmitting?"Saving...":"Submit Review"}</button>
            </div>
            <div className="space-y-3">
                {reviews.length===0?<p className="text-center text-gray-400 text-sm py-4">No reviews yet. Be the first!</p>:reviews.map(rev=>(
                    <div key={rev.id} className="bg-white border border-gray-100 p-5 rounded-[20px] shadow-sm flex flex-col gap-2">
                        <div className="flex justify-between items-center"><div className="flex items-center gap-1"><div className="flex text-yellow-400 w-16"><StarIcon fill={1}/></div><span className="text-sm font-bold ml-[-30px] pt-1">{rev.rating}</span></div><span className="text-[10px] text-gray-400">{new Date(rev.created_at).toLocaleDateString()}</span></div>
                        {rev.tags && rev.tags.length > 0 && <div className="flex flex-wrap gap-1">{rev.tags.map((t: string) => (<span key={t} className="text-[10px] bg-orange-50 text-orange-600 px-2 py-0.5 rounded-md border border-orange-100">{t}</span>))}</div>}
                        <p className="text-sm text-gray-800 font-medium leading-relaxed">{rev.content}</p>
                        <div className="flex justify-end gap-3 mt-1 pt-3 border-t border-gray-50"><button onClick={()=>handleReviewAction(rev.id, 'helpful')} className="text-[11px] text-gray-400 hover:text-green-600 flex items-center gap-1 transition-colors">👍 Helpful ({rev.helpful_count||0})</button><button onClick={()=>handleReviewAction(rev.id, 'report')} className="text-[11px] text-gray-300 hover:text-red-500 flex items-center gap-1 transition-colors">🚨 Report</button></div>
                    </div>
                ))}
            </div>
          </div>
          <div className="flex gap-3 sticky bottom-0 bg-white pt-2 pb-0"><a href={`https://map.naver.com/v5/search/${BRANDS[item.brand]?.name}`} target="_blank" rel="noopener noreferrer" className="flex-1 bg-[#03C75A] text-white font-bold py-4 rounded-2xl text-center shadow-lg active:scale-95 transition-transform hover:bg-[#02b351]">📍 Find Store</a><button onClick={close} className="flex-1 bg-gray-100 text-black font-bold py-4 rounded-2xl text-lg active:scale-95 transition-transform shadow-lg hover:bg-gray-200">Close</button></div>
        </div>
      </div>
      {isFullScreenOrder && (
        <div className="fixed inset-0 z-[100] bg-[#FFC107] flex flex-col items-center justify-center p-6 text-center animate-fade-in">
          <button onClick={() => setIsFullScreenOrder(false)} className="absolute top-6 right-6 text-4xl text-black font-black hover:scale-110 transition-transform">✕</button>
          <div ref={orderCardRef} className="bg-white p-10 rounded-[40px] shadow-2xl w-full max-w-sm border-4 border-black transform -rotate-1 relative">
            {imgSrc && <div className="w-full h-40 rounded-2xl overflow-hidden mb-4 border border-gray-100"><img src={imgSrc} alt={item.name_en} className="w-full h-full object-cover" onError={handleImgError} /></div>}
            <p className="text-lg font-bold text-gray-500 mb-2 uppercase tracking-wide">{BRANDS[item.brand]?.name}</p>
            <h1 className="text-5xl font-black text-black leading-tight break-keep mb-6">{item.name_kr}</h1>
            <p className="text-2xl font-bold text-gray-600 mb-8">({displayPartKr})</p>
            <div className="text-3xl font-black text-orange-600 border-t-2 border-dashed border-gray-200 pt-6">주세요!</div>
            <p className="text-[10px] text-gray-300 mt-4 text-center w-full">ChickenPick - Official Guide</p>
          </div>
          <button onClick={saveOrderCard} className="mt-8 bg-black text-white px-6 py-3 rounded-full font-bold shadow-xl active:scale-95 transition-transform flex items-center gap-2">📸 Save as Image</button>
        </div>
      )}
    </div>
  );
};

const CommunityCard = ({ post, dbMenus, onClick }: any) => {
    const taggedItem = post.menu_id ? dbMenus.find((m: any) => m.id === post.menu_id) : null;
    return (
        <div onClick={onClick} className="bg-white p-4 rounded-[20px] shadow-sm border border-gray-100 mb-4 cursor-pointer hover:shadow-md transition-all active:scale-[0.99] flex gap-4">
            <div className="flex flex-col items-center justify-center min-w-[40px] border-r border-gray-100 pr-4">
                <span className="text-lg text-orange-500">▲</span>
                <span className="font-bold text-sm text-gray-700">{post.upvotes || 0}</span>
            </div>
            <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-gray-500">{post.nickname}</span>
                    <span className="text-[10px] text-gray-400">• {formatDistanceToNow(new Date(post.created_at), { addSuffix: true, locale: ko })}</span>
                </div>
                <h3 className="font-bold text-lg text-gray-900 mb-1 leading-tight">{post.title}</h3>
                <p className="text-sm text-gray-500 line-clamp-2 mb-2">{post.content}</p>
                <div className="flex gap-2">
                    {taggedItem && <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-50 text-orange-600 rounded-lg text-[10px] font-bold border border-orange-100">🍗 {taggedItem.name_en}</span>}
                    {post.poll_options && <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-50 text-blue-600 rounded-lg text-[10px] font-bold border border-blue-100">📊 Vote</span>}
                </div>
            </div>
            {post.image_url && <div className="w-20 h-20 rounded-xl bg-gray-100 flex-shrink-0 overflow-hidden"><img src={post.image_url} className="w-full h-full object-cover" alt="post" /></div>}
        </div>
    );
};

const CommunityWriteModal = ({ close, refresh, dbMenus }: any) => {
    const [title, setTitle] = useState("");
    const [content, setContent] = useState("");
    const [nickname, setNickname] = useState("");
    const [password, setPassword] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isPoll, setIsPoll] = useState(false);
    const [pollOptions, setPollOptions] = useState(["", ""]);
    const [searchMenu, setSearchMenu] = useState("");
    const [taggedMenuId, setTaggedMenuId] = useState<string | null>(null);
    const [isTagInputFocused, setIsTagInputFocused] = useState(false);
    const [pollSearchQuery, setPollSearchQuery] = useState<{idx: number, query: string} | null>(null);

    const filteredMenus = useMemo(() => {
        if (!searchMenu && isTagInputFocused) return dbMenus.slice(0, 50); 
        if (!searchMenu) return [];
        return dbMenus.filter((m:any) => m.name_en.toLowerCase().includes(searchMenu.toLowerCase()) || m.name_kr.includes(searchMenu)).slice(0, 10);
    }, [searchMenu, isTagInputFocused, dbMenus]);

    const filteredPollMenus = useMemo(() => {
        if (!pollSearchQuery) return [];
        const query = pollSearchQuery.query;
        if (!query) return dbMenus.slice(0, 50); 
        return dbMenus.filter((m:any) => m.name_en.toLowerCase().includes(query.toLowerCase()) || m.name_kr.includes(query)).slice(0, 10);
    }, [pollSearchQuery, dbMenus]);

    const handleWrite = async () => {
        if(!nickname || !password || !title || !content) return toast.error("Please fill all fields");
        setIsSubmitting(true);
        let finalPollOptions = null, finalPollVotes = null;
        if(isPoll) {
            const validOptions = pollOptions.filter(o => o.trim() !== "");
            if(validOptions.length < 2) { setIsSubmitting(false); return toast.error("At least 2 poll options required"); }
            finalPollOptions = validOptions;
            finalPollVotes = validOptions.reduce((acc:any, _, idx) => ({...acc, [idx]: 0}), {});
        }
        const { error } = await supabase.from('posts').insert({ nickname, password, title, content, menu_id: taggedMenuId, poll_options: finalPollOptions, poll_votes: finalPollVotes });
        if(error) toast.error("Error: " + error.message); else { toast.success("Posted! 🎉"); refresh(); close(); }
        setIsSubmitting(false);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={close}></div>
            <div className="bg-white w-full max-w-lg rounded-[30px] p-6 z-10 relative animate-slide-up max-h-[90vh] overflow-y-auto">
                <h2 className="text-xl font-black text-gray-900 mb-6">Write Post ✏️</h2>
                <div className="flex gap-2 mb-4">
                    <input className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-500" placeholder="Nickname" value={nickname} onChange={e=>setNickname(e.target.value)} />
                    <input className="flex-1 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-500" type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)} />
                </div>
                <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-bold text-gray-900 placeholder:text-gray-400 mb-4 focus:outline-none focus:border-orange-500" placeholder="Title" value={title} onChange={e=>setTitle(e.target.value)} />
                <textarea className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 mb-4 h-32 focus:outline-none focus:border-orange-500" placeholder="What's on your mind?" value={content} onChange={e=>setContent(e.target.value)}></textarea>
                
                <div className="mb-4 relative">
                    <p className="text-xs font-bold text-gray-400 mb-2">Tag Chicken (Optional)</p>
                    {taggedMenuId ? (
                        <div className="flex items-center gap-2 bg-orange-50 p-3 rounded-xl border border-orange-100">
                            <span className="text-lg">🍗</span>
                            <span className="text-sm font-bold text-orange-600">{dbMenus.find((m:any) => m.id === taggedMenuId)?.name_en}</span>
                            <button onClick={() => setTaggedMenuId(null)} className="ml-auto text-gray-400 hover:text-red-500 font-bold px-2">✕</button>
                        </div>
                    ) : (
                        <div>
                            <input className="w-full bg-white border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:border-orange-500 focus:ring-1 focus:ring-orange-200" placeholder="Search chicken..." value={searchMenu} onChange={e=>setSearchMenu(e.target.value)} onFocus={() => setIsTagInputFocused(true)}/>
                            {(searchMenu || isTagInputFocused) && filteredMenus.length > 0 && (
                                <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-xl mt-1 z-50 max-h-48 overflow-y-auto">
                                    {filteredMenus.map((m:any) => (
                                        <div key={m.id} onClick={() => { setTaggedMenuId(m.id); setSearchMenu(""); setIsTagInputFocused(false); }} className="p-3 hover:bg-orange-50 text-sm cursor-pointer border-b border-gray-50 last:border-0 flex items-center gap-2"><span className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded bg-gray-400 uppercase">{BRANDS[m.brand]?.name}</span><span className="font-bold text-gray-900">{m.name_en}</span></div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="mb-6">
                    <label className="flex items-center gap-2 cursor-pointer mb-2"><input type="checkbox" checked={isPoll} onChange={e=>setIsPoll(e.target.checked)} className="accent-orange-500 w-4 h-4" /><span className="text-sm font-bold text-gray-600">Create Poll 📊</span></label>
                    {isPoll && (
                        <div className="space-y-3 pl-4 border-l-2 border-orange-100 mt-3">
                            {pollOptions.map((opt, idx) => (
                                <div key={idx} className="relative">
                                    <input className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-medium text-gray-900 placeholder:text-gray-400 focus:outline-none focus:bg-white focus:border-orange-500" placeholder={`Option ${idx+1}`} value={opt} onChange={e => { const newOpts = [...pollOptions]; newOpts[idx] = e.target.value; setPollOptions(newOpts); setPollSearchQuery({ idx, query: e.target.value }); }} onFocus={() => setPollSearchQuery({ idx, query: opt })} />
                                    {pollSearchQuery?.idx === idx && filteredPollMenus.length > 0 && (
                                        <div className="absolute top-full left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-xl mt-1 z-50 max-h-40 overflow-y-auto">
                                            {filteredPollMenus.map((m:any) => (
                                                <div key={m.id} onMouseDown={() => { const newOpts = [...pollOptions]; newOpts[idx] = `[${BRANDS[m.brand]?.name}] ${m.name_en}`; setPollOptions(newOpts); setPollSearchQuery(null); }} className="p-3 hover:bg-orange-50 text-sm cursor-pointer border-b border-gray-50 flex items-center gap-2"><span className="text-[10px] font-bold text-white px-1.5 py-0.5 rounded bg-gray-400 uppercase">{BRANDS[m.brand]?.name}</span><span className="font-bold text-gray-900">{m.name_en}</span></div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                            <button onClick={() => setPollOptions([...pollOptions, ""])} className="text-xs text-orange-500 font-bold hover:underline px-2">+ Add Option</button>
                        </div>
                    )}
                </div>
                <button onClick={handleWrite} disabled={isSubmitting} className="w-full bg-black text-white font-bold py-4 rounded-xl text-sm shadow-lg active:scale-95 transition-transform">{isSubmitting ? "Posting..." : "Post Now"}</button>
            </div>
        </div>
    );
};

const CommunityPostModal = ({ postId, close, dbMenus, setSelectedItem }: any) => {
    const [post, setPost] = useState<any>(null);
    const [comments, setComments] = useState<any[]>([]);
    const [cmtContent, setCmtContent] = useState("");
    const [cmtNick, setCmtNick] = useState("");
    const [cmtPw, setCmtPw] = useState("");

    useEffect(() => {
        const load = async () => {
            const { data: p } = await supabase.from('posts').select('*').eq('id', postId).single();
            setPost(p);
            const { data: c } = await supabase.from('comments').select('*').eq('post_id', postId).order('created_at', {ascending: true});
            setComments(c || []);
            await supabase.from('posts').update({ view_count: (p?.view_count || 0) + 1 }).eq('id', postId);
        };
        load();
    }, [postId]);

    const handleVote = async (optIdx: number) => {
        if(!post) return;
        const newVotes = { ...post.poll_votes, [optIdx]: (post.poll_votes[optIdx] || 0) + 1 };
        setPost({ ...post, poll_votes: newVotes });
        await supabase.from('posts').update({ poll_votes: newVotes }).eq('id', postId);
        toast.success("Voted!");
    };

    const handleComment = async () => {
        if(!cmtNick || !cmtPw || !cmtContent) return toast.error("Fill all fields");
        const { error } = await supabase.from('comments').insert({ post_id: postId, nickname: cmtNick, password: cmtPw, content: cmtContent });
        if(!error) {
            setCmtContent("");
            const { data: c } = await supabase.from('comments').select('*').eq('post_id', postId).order('created_at', {ascending: true});
            setComments(c || []);
        }
    };

    if(!post) return null;
    const taggedItem = post.menu_id ? dbMenus.find((m:any) => m.id === post.menu_id) : null;
    const totalVotes = post.poll_votes ? Object.values(post.poll_votes).reduce((a:any, b:any) => a+b, 0) : 0;

    return (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
            <div className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity" onClick={close}></div>
            <div className="bg-white w-full max-w-lg rounded-t-[30px] sm:rounded-[30px] p-6 z-10 relative animate-slide-up max-h-[90vh] overflow-y-auto">
                <div className="w-12 h-1.5 bg-gray-200 rounded-full mx-auto mb-6 sm:hidden"></div>
                <div className="flex items-center gap-2 mb-2"><span className="text-sm font-bold text-gray-900">{post.nickname}</span><span className="text-xs text-gray-400">• {new Date(post.created_at).toLocaleDateString()}</span></div>
                <h1 className="text-2xl font-black text-gray-900 mb-4 leading-snug">{post.title}</h1>
                <div className="text-gray-700 leading-relaxed whitespace-pre-wrap mb-6 text-sm">{post.content}</div>
                
                {taggedItem && (
                    <div onClick={() => { close(); setSelectedItem({item: taggedItem, part: taggedItem.tags?.[0] || "Whole"}); }} className="flex items-center gap-3 bg-orange-50 p-3 rounded-xl border border-orange-100 mb-6 cursor-pointer hover:bg-orange-100">
                        <div className="w-12 h-12 rounded-lg bg-white overflow-hidden"><div className="w-full h-full bg-gray-200"></div></div>
                        <div><p className="text-[10px] font-bold text-orange-500 uppercase">{BRANDS[taggedItem.brand]?.name}</p><p className="font-bold text-gray-900">{taggedItem.name_en}</p></div><span className="ml-auto text-xl">👉</span>
                    </div>
                )}
                
                {post.poll_options && (
                    <div className="bg-gray-50 p-4 rounded-2xl border border-gray-100 mb-6"><p className="text-xs font-bold text-gray-500 mb-3 uppercase">Poll</p><div className="space-y-2">{post.poll_options.map((opt: string, idx: number) => { const votes = post.poll_votes?.[idx] || 0; const percent = (totalVotes as number) > 0 ? Math.round((votes / (totalVotes as number)) * 100) : 0; return (<button key={idx} onClick={() => handleVote(idx)} className="w-full relative h-10 rounded-lg bg-white border border-gray-200 overflow-hidden text-left hover:border-orange-500 transition-colors"><div className="absolute top-0 left-0 h-full bg-orange-100 transition-all duration-500" style={{ width: `${percent}%` }}></div><div className="absolute inset-0 flex items-center justify-between px-3"><span className="text-sm font-bold text-gray-700 z-10">{opt}</span><span className="text-xs text-orange-600 font-bold z-10">{percent}% ({votes})</span></div></button>)})}</div></div>
                )}
                
                <hr className="border-gray-100 mb-6" />
                <div className="mb-20"><h3 className="font-bold text-lg mb-4">Comments ({comments.length})</h3><div className="space-y-4 mb-6">{comments.map(c => (<div key={c.id} className="bg-gray-50 p-3 rounded-xl"><div className="flex justify-between items-center mb-1"><span className="text-xs font-bold text-gray-900">{c.nickname}</span><span className="text-[10px] text-gray-400">{formatDistanceToNow(new Date(c.created_at), { addSuffix: true })}</span></div><p className="text-sm text-gray-700">{c.content}</p></div>))}</div><div className="flex gap-2 mb-2"><input className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs" placeholder="Nick" value={cmtNick} onChange={e=>setCmtNick(e.target.value)} /><input className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-xs" type="password" placeholder="PW" value={cmtPw} onChange={e=>setCmtPw(e.target.value)} /></div><div className="flex gap-2"><input className="flex-1 bg-white border border-gray-300 rounded-lg px-3 py-2 text-sm" placeholder="Add a comment..." value={cmtContent} onChange={e=>setCmtContent(e.target.value)} /><button onClick={handleComment} className="bg-black text-white px-4 py-2 rounded-lg text-sm font-bold">Send</button></div></div>
            </div>
        </div>
    );
};

// --- [Main Page] ---
export default function Home() {
  const [viewMode, setViewMode] = useState<"home" | "community">("home");
  const [currentBrand, setCurrentBrand] = useState("all");
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [spicyFilter, setSpicyFilter] = useState<number | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedItem, setSelectedItem] = useState<any>(null); 
  const [sortBy, setSortBy] = useState<"rating" | "name" | "brand">("rating");
  const [favorites, setFavorites] = useState<string[]>([]);
  const [showFavoritesOnly, setShowFavoritesOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(15); 
  const [showTopBtn, setShowTopBtn] = useState(false);
  const [dbMenus, setDbMenus] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [posts, setPosts] = useState<any[]>([]);
  const [isWriteModalOpen, setIsWriteModalOpen] = useState(false);
  const [viewPostId, setViewPostId] = useState<number | null>(null);
  const isDragging = useRef(false);

  const fetchMenus = async () => {
    const { data, error } = await supabase.from("menus").select("*");
    if (error) { toast.error("Failed to load menus"); setIsLoading(false); return; }
    if (data) {
      const mapped = data.map((item: any) => ({
        ...item,
        desc: item.desc_text,
        metrics: { spicy: item.metrics?.spicy ?? 0, crunch: item.metrics?.crunch ?? 0, sweet: item.metrics?.sweet ?? 0, garlic: item.metrics?.garlic ?? 0 },
        tags: item.tags ?? [],
      }));
      setDbMenus(mapped);
    }
    setIsLoading(false);
  };

  const fetchPosts = async () => {
    const { data } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
    if(data) setPosts(data);
  };

  useEffect(() => { fetchMenus(); fetchPosts(); const saved = localStorage.getItem("myChickenFavorites"); if (saved) setFavorites(JSON.parse(saved)); }, []);
  useEffect(() => {
    const handleScroll = () => {
      if (window.scrollY > 300) setShowTopBtn(true); else setShowTopBtn(false);
      if (viewMode === 'home' && window.innerHeight + window.scrollY >= document.body.offsetHeight - 200) { setVisibleCount(prev => prev + 10); }
    };
    window.addEventListener("scroll", handleScroll); return () => window.removeEventListener("scroll", handleScroll);
  }, [viewMode]);
  useEffect(() => { if(viewMode === 'home'){ setVisibleCount(15); window.scrollTo(0, 0); } }, [currentBrand, activeFilters, spicyFilter, searchText, showFavoritesOnly, sortBy, viewMode]);
  
  const toggleFilter = (filterId: string) => { if (filterId === "all") { setActiveFilters([]); setSpicyFilter(null); } else { setActiveFilters(prev => prev.includes(filterId) ? prev.filter(f => f !== filterId) : [...prev, filterId]); if (filterId === 'spicy' && activeFilters.includes('spicy')) setSpicyFilter(null); } };

  const groupedMenuData = useMemo(() => {
    if (isLoading && dbMenus.length === 0) return [];
    const filtered = dbMenus.filter((item) => {
      if (showFavoritesOnly && !favorites.includes(item.id)) return false;
      const brandMatch = currentBrand === "all" || item.brand === currentBrand;
      const searchMatch = item.name_en.toLowerCase().includes(searchText.toLowerCase()) || item.name_kr.includes(searchText) || (item.desc && item.desc.toLowerCase().includes(searchText.toLowerCase()));
      const tagMatch = activeFilters.every(filter => {
          if (filter === "boneless") { const hasBonelessTag = item.tags?.some((t: string) => t.toLowerCase().includes("boneless") || t.includes("순살")); const hasBonelessName = item.name_en.toLowerCase().includes("boneless") || item.name_kr.includes("순살"); return hasBonelessTag || hasBonelessName; }
          if (filter === "cheese") return item.name_kr.includes("치즈") || item.name_en.toLowerCase().includes("cheese");
          if (filter === "sweet") return item.metrics.sweet >= 3;
          if (filter === "garlic") return item.metrics.garlic >= 2;
          if (filter === "crunch") return item.metrics.crunch >= 4;
          if (filter === "spicy") return item.metrics.spicy >= 1; 
          return true;
      });
      const spicyLevelMatch = spicyFilter === null ? true : item.metrics.spicy === spicyFilter;
      if (searchText === "" && item.type === "burger") return false;
      return brandMatch && searchMatch && tagMatch && spicyLevelMatch;
    });

    const groups: Record<string, { baseName: string; variants: any[] }> = {};
    filtered.forEach((item) => {
        const baseName = normalizeBaseName(item.name_kr || item.name_en || item.id).replace(/ (콤보|순살|윙|스틱|다리).*/, "");
        const groupKey = `${item.brand}-${baseName}`;
        if (!groups[groupKey]) groups[groupKey] = { baseName, variants: [] };
        groups[groupKey].variants.push(item);
    });
    Object.values(groups).forEach((g) => { g.variants.sort((a, b) => (a.price || 0) - (b.price || 0)); });
    let result = Object.values(groups);
    
    result.sort((a: any, b: any) => {
        const itemA = a.variants[0]; const itemB = b.variants[0];
        if (sortBy === "rating") { const r = (itemB.avg_rating||0)-(itemA.avg_rating||0); return r!==0?r:(itemB.review_count||0)-(itemA.review_count||0); }
        else if (sortBy === "name") return itemA.name_kr.localeCompare(itemB.name_kr);
        else return itemA.brand.localeCompare(itemB.brand);
    });
    return result;
  }, [currentBrand, activeFilters, spicyFilter, searchText, showFavoritesOnly, favorites, dbMenus, isLoading, sortBy]);

  const visibleGroups = groupedMenuData.slice(0, visibleCount);
  const toggleFavorite = (id: string) => { let newFavs = favorites.includes(id) ? favorites.filter(f => f !== id) : [...favorites, id]; setFavorites(newFavs); localStorage.setItem("myChickenFavorites", JSON.stringify(newFavs)); };
  const scrollToTop = () => window.scrollTo({ top: 0, behavior: "smooth" });

  return (
    <div className="min-h-screen font-sans pb-20 selection:bg-orange-100 bg-[#f0f2f5]">
      <style jsx global>{` @import url("https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"); body { font-family: 'Pretendard', sans-serif; } `}</style>
      <Toaster position="bottom-center" toastOptions={{style:{background:'#1F2937',color:'#fff',fontSize:'14px',borderRadius:'12px', padding: '12px 20px'}}} />
      <div className="max-w-md mx-auto bg-white min-h-screen shadow-2xl shadow-black/5 relative">
        <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-xl border-b border-gray-100 px-5 py-4">
          <div className="flex justify-between items-end mb-4">
            <div onClick={() => { window.location.reload(); setViewMode("home"); }} className="cursor-pointer active:scale-95 transition-transform">
              <h1 className="text-3xl font-black text-orange-500 tracking-tighter leading-none">CHICKEN<span className="text-gray-900">PICK</span></h1>
              <p className="text-[10px] text-gray-400 font-bold tracking-widest uppercase mt-1">The Official K-Chicken Guide</p>
            </div>
            <div className="flex gap-2">
                <div className="flex gap-2 items-center"> {/* [FIX] Added wrapper div for proper alignment */}
                  <button onClick={() => setViewMode(viewMode === "home" ? "community" : "home")} className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 flex items-center gap-1 h-fit ${viewMode === 'community' ? 'bg-orange-500 text-white shadow-lg' : 'bg-gray-100 text-gray-500'}`}>{viewMode === "home" ? "💬 Community" : "🏠 Home"}</button>
                  {viewMode === "home" && (<button onClick={() => setShowFavoritesOnly(!showFavoritesOnly)} className={`text-xs font-bold px-3 py-1.5 rounded-full transition-all active:scale-95 flex items-center gap-1 h-fit ${showFavoritesOnly ? 'bg-red-500 text-white shadow-lg shadow-red-200' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}>❤️ Picks ({favorites.length})</button>)}
                </div>
            </div>
          </div>
          {viewMode === "home" && (
              <>
                <div className="flex gap-2 mb-4">
                    <div className="relative group flex-1"><input type="text" placeholder="Search..." className="w-full bg-gray-100 rounded-2xl py-3.5 pl-10 pr-4 text-sm font-semibold focus:outline-none focus:bg-white focus:ring-2 focus:ring-orange-100 transition-all" onChange={(e) => setSearchText(e.target.value)} /><span className="absolute left-3.5 top-3.5 text-gray-400">🔍</span></div>
                    <select value={sortBy} onChange={(e:any) => setSortBy(e.target.value)} className="bg-white border border-gray-200 rounded-2xl px-3 text-xs font-bold text-gray-600 focus:outline-none focus:border-orange-500 outline-none"><option value="rating">⭐ Rating</option><option value="name">🔤 Name</option><option value="brand">🏷️ Brand</option></select>
                </div>
                {!showFavoritesOnly && (
                    <div onMouseDown={()=>isDragging.current=false} onMouseMove={()=>isDragging.current=true}>
                    {/* [수정] 맛 필터: 화살표 복구 (Goal 1 - showArrows={true}로 변경) 및 정렬 유지 */}
                    <ScrollableRow className="flex gap-2 pb-1 items-center" paddingClass="px-5" arrowYClass="top-0 bottom-0 items-center" arrowLeftClass="left-0" arrowRightClass="right-0">
                    <button onClick={(e) => { if(isDragging.current) return; toggleFilter("all"); }} className={`px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 flex-shrink-0 ${activeFilters.length === 0 ? "bg-gray-900 text-white shadow-lg shadow-gray-200" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>All</button>
                    <div className={`flex items-center rounded-2xl transition-all flex-shrink-0 border ${activeFilters.includes("spicy") ? "bg-red-50 border-red-200 pr-1" : "bg-white border-gray-200"}`}>
                        <button onClick={() => toggleFilter("spicy")} className={`px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 ${activeFilters.includes("spicy") ? "text-red-600" : "text-gray-500 hover:text-gray-900"}`}>🔥 Spicy</button>
                        {activeFilters.includes("spicy") && (<div className="flex gap-1 animate-fade-in pl-1"><button onClick={(e) => { if(isDragging.current) return; setSpicyFilter(null); }} className={`w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors ${spicyFilter === null ? "bg-red-500 text-white shadow-md" : "bg-white border border-red-200 text-red-400"}`}>All</button>{[1, 2, 3, 4, 5].map(lv => (<button key={lv} onClick={() => { if(isDragging.current) return; setSpicyFilter(lv); }} className={`w-7 h-7 rounded-full text-[10px] font-bold flex items-center justify-center transition-colors ${spicyFilter === lv ? "bg-red-500 text-white shadow-md" : "bg-white border border-red-200 text-red-400"}`}>{lv}</button>))}</div>)}
                    </div>
                    {[{id:"crunch",l:"💥 Crispy"},{id:"sweet",l:"🍯 Sweet"},{id:"cheese",l:"🧀 Cheese"},{id:"garlic",l:"🧄 Garlic"},{id:"boneless",l:"🍗 Boneless"}].map(btn => (
                        <button key={btn.id} onClick={() => toggleFilter(btn.id)} className={`px-4 py-2.5 rounded-2xl text-xs font-bold whitespace-nowrap transition-all active:scale-95 flex-shrink-0 ${activeFilters.includes(btn.id) ? "bg-gray-900 text-white shadow-lg shadow-gray-200 ring-2 ring-gray-900 ring-offset-1" : "bg-white border border-gray-200 text-gray-500 hover:bg-gray-50"}`}>{btn.l}</button>
                    ))}
                    </ScrollableRow>
                    </div>
                )}
              </>
          )}
          {viewMode === "community" && (<div className="py-2"><h2 className="text-xl font-bold text-gray-900 mb-1">Community 🔥</h2><p className="text-sm text-gray-500">Let's talk about Chicken!</p></div>)}
        </header>

        {viewMode === "home" && (
            <>
                {!showFavoritesOnly && (
                <div className="bg-white border-b border-gray-50" onMouseDown={()=>isDragging.current=false} onMouseMove={()=>isDragging.current=true}>
                    <ScrollableRow className="flex gap-4 py-10" paddingClass="px-5" arrowLeftClass="left-0" arrowRightClass="right-0">
                    {Object.keys(BRANDS).map((key) => (
                        <button key={key} onClick={(e) => { if(isDragging.current) return; setCurrentBrand(key); }} className={`flex flex-col items-center gap-2 min-w-[60px] transition-all active:scale-95 ${currentBrand === key ? "opacity-100" : "opacity-40 hover:opacity-70"}`}>
                        <BrandIcon brandKey={key} isActive={currentBrand === key} />
                        <span className={`text-[10px] font-bold truncate w-full text-center transition-colors ${currentBrand === key ? "text-orange-600" : "text-gray-400"}`}>{BRANDS[key].name}</span>
                        </button>
                    ))}
                    </ScrollableRow>
                </div>
                )}
                <div className="p-5 space-y-6 bg-gray-50/50 min-h-[60vh]">
                {isLoading && dbMenus.length === 0 ? ([...Array(5)].map((_, i) => <ChickenCardSkeleton key={i} />)) : visibleGroups.length === 0 ? (<div className="text-center py-24 text-gray-300"><div className="text-6xl mb-4 grayscale opacity-50">🐔❓</div><p className="font-bold">No chicken found.</p></div>) : (visibleGroups.map((group: any) => (<ChickenCard key={group.baseName + group.variants[0].brand} group={group} toggleFavorite={toggleFavorite} favorites={favorites} openModal={(item: any) => setSelectedItem({item, part: (item.tags && item.tags.length>0 ? item.tags[0] : "Whole")})} />)))}
                {!isLoading && visibleCount < groupedMenuData.length && <div className="text-center py-8"><div className="inline-block w-8 h-8 border-[3px] border-orange-200 border-t-orange-500 rounded-full animate-spin"></div></div>}
                </div>
            </>
        )}

        {viewMode === "community" && (
            <div className="p-5 bg-gray-50/50 min-h-[80vh]">
                {posts.map(post => <CommunityCard key={post.id} post={post} dbMenus={dbMenus} onClick={() => setViewPostId(post.id)} />)}
                {posts.length === 0 && <div className="text-center py-20 text-gray-400">No posts yet. Be the first!</div>}
                <button onClick={() => setIsWriteModalOpen(true)} className="fixed bottom-24 right-6 z-30 bg-orange-500 text-white p-4 rounded-full shadow-2xl hover:bg-orange-600 transition-colors animate-bounce active:scale-90">✏️</button>
            </div>
        )}

        {showTopBtn && <button onClick={scrollToTop} className="fixed bottom-6 right-6 z-30 bg-gray-900 text-white p-3.5 rounded-full shadow-2xl hover:bg-orange-500 transition-colors animate-bounce active:scale-90">⬆️</button>}

        {selectedItem && (<DetailModal item={selectedItem.item} selectedPart={selectedItem.part} close={() => setSelectedItem(null)} toggleFavorite={toggleFavorite} isFavorite={favorites.includes(selectedItem.item.id)} refreshData={fetchMenus} />)}
        {isWriteModalOpen && <CommunityWriteModal close={() => setIsWriteModalOpen(false)} refresh={fetchPosts} dbMenus={dbMenus} />}
        {viewPostId && <CommunityPostModal postId={viewPostId} close={() => setViewPostId(null)} dbMenus={dbMenus} setSelectedItem={setSelectedItem} />}
      </div>
    </div>
  );
}