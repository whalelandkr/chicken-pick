"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";

// 환경변수 확인
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("환경변수 오류: .env.local 파일을 확인해주세요.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- [핵심 유틸리티] ---

// 1. CSV 파서 (줄바꿈, 따옴표 완벽 처리)
function parseCSV(text: string) {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        currentField += '"'; i++;
      } else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      currentRow.push(currentField); currentField = "";
    } else if ((char === '\r' || char === '\n') && !inQuotes) {
      if (char === '\r' && nextChar === '\n') i++;
      currentRow.push(currentField); rows.push(currentRow);
      currentRow = []; currentField = "";
    } else { currentField += char; }
  }
  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField); rows.push(currentRow);
  }
  return rows;
}

// 2. 한글명 안전 변환기 (해시 생성)
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

function makeObjectKeyFromId(id: string) {
  const base = normalizeBaseName(id);
  const safe = fnv1a32x2Hex(base);
  return `${safe}.webp`;
}

// 3. 이미지 WebP 변환
async function fileToWebpBlob(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/")) throw new Error("이미지 파일이 아닙니다.");
  try {
    const bitmap = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 생성 실패");
    ctx.drawImage(bitmap, 0, 0);
    return new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej("WebP 변환 실패"), "image/webp", 0.9));
  } catch (e) {
    throw new Error("이미지 변환 실패 (CMYK 또는 손상된 파일)");
  }
}

// --- 메인 컴포넌트 ---
export default function AdminPage() {
  const [status, setStatus] = useState("준비 완료");
  const [isLoading, setIsLoading] = useState(false);
  const [failedList, setFailedList] = useState<string[]>([]);

  // 1. 메뉴 이미지 업로드 (무조건 해시 변환 -> 안전)
  const handleImageUpload = async (e: any) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsLoading(true); setStatus("메뉴 이미지 업로드 중..."); setFailedList([]);
    let success = 0; let fail = 0;

    for (const file of files) {
      try {
        const lastDot = file.name.lastIndexOf(".");
        const name = file.name.substring(0, lastDot); 
        const objectKey = makeObjectKeyFromId(name);
        const webpBlob = await fileToWebpBlob(file);

        const { error } = await supabase.storage.from("chicken-images").upload(objectKey, webpBlob, { upsert: true, contentType: "image/webp" });
        if (error) throw error;
        success++;
      } catch (err: any) { 
        fail++; setFailedList(prev => [...prev, `[메뉴] ${file.name}: ${err.message}`]);
      }
      setStatus(`메뉴 이미지 처리 중... (성공 ${success} / 실패 ${fail})`);
    }
    setStatus(`✅ 메뉴 이미지 완료! 성공 ${success}, 실패 ${fail}`);
    setIsLoading(false);
  };

  // 2. 브랜드 로고 업로드 (Invalid Key 해결 로직 적용)
  const handleLogoUpload = async (e: any) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsLoading(true); setStatus("브랜드 로고 업로드 중..."); setFailedList([]);
    let success = 0; let fail = 0;

    for (const file of files) {
      try {
        const lastDot = file.name.lastIndexOf(".");
        const name = file.name.substring(0, lastDot); // 확장자 제외 이름
        const ext = file.name.substring(lastDot).toLowerCase(); // 확장자 (.svg)

        // [핵심] 한글이 포함되었는지 검사
        const isEnglishOnly = /^[a-zA-Z0-9_.-]+$/.test(name);
        
        let finalName;
        if (isEnglishOnly) {
            // 영어면 그대로 사용 (브랜드 ID와 매칭하기 위해)
            finalName = name; 
        } else {
            // 한글/특수문자가 있으면 -> 해시로 변환 (Invalid Key 방지)
            // *주의: 이렇게 변환되면 메인화면에서 자동 매칭은 안 됩니다. 영어 파일명 권장.
            finalName = fnv1a32x2Hex(name); 
        }

        const objectKey = `brand_${finalName}${ext}`; // 예: brand_bbq.svg 또는 brand_a1b2.svg

        const { error } = await supabase.storage
          .from("chicken-images")
          .upload(objectKey, file, { 
            upsert: true, 
            contentType: file.type 
          });

        if (error) throw error;
        success++;
      } catch (err: any) { 
        fail++; setFailedList(prev => [...prev, `[로고] ${file.name}: ${err.message}`]);
      }
      setStatus(`로고 처리 중... (성공 ${success} / 실패 ${fail})`);
    }
    setStatus(`✅ 로고 업로드 완료! 성공 ${success}, 실패 ${fail}`);
    setIsLoading(false);
  };

  // 3. CSV 업로드
  const handleCsvUpload = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;
    setIsLoading(true); setStatus("CSV 분석 중..."); setFailedList([]);

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      if (!text) return;

      try {
        const allRows = parseCSV(text);
        const dataRows = allRows.slice(1).filter(row => row.length > 1 && row[0]);

        const formattedData = dataRows.map((cols) => {
          const id = cols[0]?.trim();
          if (!id) return null;

          const objectKey = makeObjectKeyFromId(id);
          const { data: pub } = supabase.storage.from("chicken-images").getPublicUrl(objectKey);

          const getLevel = (val: string) => {
             if(!val) return 0;
             const starCount = (val.match(/★/g) || []).length;
             return starCount > 0 ? starCount : (Number(val.replace(/[^0-9]/g, '')) || 0);
          };

          return {
            id: id,
            brand: cols[1]?.trim(),
            name_kr: cols[2]?.trim(),
            name_en: cols[3]?.trim(),
            type: "chicken",
            price: Number(cols[6]?.replace(/,/g, '')) || 0,
            desc_text: cols[8]?.trim(),
            allergens: cols[10]?.trim(),
            image_url: pub.publicUrl,
            metrics: {
              spicy: getLevel(cols[12]),
              crunch: getLevel(cols[13]),
              sweet: getLevel(cols[14]),
              garlic: 0
            },
            tags: cols[5] ? cols[5].split(',').map(t => t.trim()) : []
          };
        }).filter(item => item !== null);

        const { error } = await supabase.from("menus").upsert(formattedData);
        if (error) throw error;

        setStatus(`✅ 데이터 업로드 성공! (${formattedData.length}개)`);
      } catch (err: any) {
        setStatus(`❌ 오류: ${err.message}`);
        setFailedList([err.message]);
      } finally {
        setIsLoading(false);
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-10">
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-lg text-center">
        <h1 className="text-2xl font-bold mb-6">🍗 데이터 관리자</h1>
        
        <div className="space-y-6">
          <div className="p-4 border-2 border-dashed border-blue-300 bg-blue-50 rounded-xl">
            <p className="font-bold text-blue-600 mb-2">1. 메뉴 사진 업로드 (한글OK)</p>
            <input type="file" multiple accept="image/*" onChange={handleImageUpload} />
          </div>

          <div className="p-4 border-2 border-dashed border-purple-300 bg-purple-50 rounded-xl">
            <p className="font-bold text-purple-600 mb-2">2. 브랜드 로고 업로드 (SVG/PNG)</p>
            <p className="text-xs text-purple-400 mb-2">* 로고 파일명은 영어(예: bbq.svg)여야 메인에 자동 노출됩니다.</p>
            <input type="file" multiple accept=".svg,.png" onChange={handleLogoUpload} />
          </div>

          <div className="p-4 border-2 border-dashed border-orange-300 bg-orange-50 rounded-xl">
            <p className="font-bold text-orange-600 mb-2">3. CSV 데이터 업로드</p>
            <input type="file" accept=".csv" onChange={handleCsvUpload} />
          </div>
        </div>

        <p className="mt-6 font-bold text-gray-800 break-keep">{status}</p>

        {failedList.length > 0 && (
          <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl text-left">
            <p className="font-bold text-red-600 mb-2">❌ 실패 목록:</p>
            <ul className="text-xs text-red-500 space-y-1 max-h-40 overflow-y-auto">
              {failedList.map((msg, idx) => <li key={idx}>• {msg}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}