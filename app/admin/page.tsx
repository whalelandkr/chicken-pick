"use client";

import { useState } from "react";
import { createClient } from "@supabase/supabase-js";
import Papa from "papaparse"; 
import toast, { Toaster } from "react-hot-toast";

// --- [Supabase 설정] ---
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error("환경변수 오류: .env.local 파일을 확인해주세요.");
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

// --- [핵심 유틸리티 함수] ---

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

// --- [메인 컴포넌트] ---
export default function AdminPage() {
  const [status, setStatus] = useState("준비 완료");
  const [isLoading, setIsLoading] = useState(false);
  const [failedList, setFailedList] = useState<string[]>([]);

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

  const handleLogoUpload = async (e: any) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    
    setIsLoading(true); setStatus("브랜드 로고 업로드 중..."); setFailedList([]);
    let success = 0; let fail = 0;

    for (const file of files) {
      try {
        const lastDot = file.name.lastIndexOf(".");
        const name = file.name.substring(0, lastDot);
        const ext = file.name.substring(lastDot).toLowerCase();
        const isEnglishOnly = /^[a-zA-Z0-9_.-]+$/.test(name);
        
        let finalName;
        if (isEnglishOnly) { finalName = name; } 
        else { finalName = fnv1a32x2Hex(name); }

        const objectKey = `brand_${finalName}${ext}`;

        const { error } = await supabase.storage.from("chicken-images").upload(objectKey, file, { upsert: true, contentType: file.type });
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

  // 3. CSV 데이터 업로드 (디버깅 강화)
  const handleCsvUpload = async (e: any) => {
    const file = e.target.files[0];
    if (!file) return;

    setIsLoading(true); setStatus("CSV 분석 중..."); setFailedList([]);

    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (header) => header.trim(), // 헤더 공백 제거
      complete: async (results) => {
        try {
          if (results.errors.length > 0) {
              console.error("CSV 파싱 경고:", results.errors);
          }

          const rows = results.data.map((row: any) => {
            const cleanPrice = row.price ? parseInt(row.price.toString().replace(/,/g, ""), 10) : 0;
            
            const getLevel = (val: string) => {
                if(!val) return 0;
                const starCount = (val.match(/★/g) || []).length;
                return starCount > 0 ? starCount : (Number(val.replace(/[^0-9]/g, '')) || 0);
            };

            const id = row.id?.trim();
            const objectKey = id ? makeObjectKeyFromId(id) : "";
            const { data: pub } = supabase.storage.from("chicken-images").getPublicUrl(objectKey);

            const tagSource = row['part_type(en)'] || row.part_type;
            const tags = tagSource ? tagSource.split(",").map((t:string) => t.trim()) : [];

            return {
              id: id,
              brand: row.brand_id, 
              
              // [데이터 매핑]
              name_kr: row.name_kr,
              name_en: row.name_en,
              name_ja: row.name_ja,
              name_zh: row.name_zh,         
              name_zhHant: row.name_zhHant, 

              desc_text: row.description,
              description_en: row['description(en)'] || row.description_en, // DB 컬럼: description_en
              description_ja: row.description_ja || row.desc_jp,
              description_zh: row.description_zh || row.desc_cn,
              description_zhHant: row.description_zhHant || row.desc_zhHant,

              allergens: row.allergens,
              allergens_en: row['allergens(en)'] || row.allergens_en, // DB 컬럼: allergens_en
              allergens_ja: row.allergens_ja,
              allergens_zh: row.allergens_zh,
              allergens_zhHant: row.allergens_zhHant,
              
              price: cleanPrice,
              type: "chicken",
              tags: tags,
              image_url: pub.publicUrl, 

              metrics: {
                spicy: getLevel(row.level_spicy),
                crunch: getLevel(row.level_crunch),
                sweet: getLevel(row.level_sweet),
                garlic: 0
              }
            };
          }).filter((r: any) => r.id);

          if (rows.length === 0) {
              throw new Error("업로드할 데이터가 없습니다. CSV 헤더(id, brand_id 등)를 확인하세요.");
          }

          // [디버깅] 실제 전송되는 데이터 확인 (첫번째 줄만)
          console.log("🔥 전송 데이터 미리보기(첫 1개):", rows[0]);
          
          setStatus(`데이터베이스 업로드 중... (${rows.length}개)`);

          // Supabase 업서트
          const { error } = await supabase.from("menus").upsert(rows, { onConflict: "id" });
          
          if (error) {
              // 에러 상세 내용을 강제로 문자열로 변환하여 출력
              console.error("🔥 Supabase Error Details:", JSON.stringify(error, null, 2));
              throw new Error(`DB 오류: ${error.message} (콘솔 확인)`);
          }

          setStatus(`✅ CSV 업로드 성공! (총 ${rows.length}개 메뉴 업데이트)`);
          toast.success("데이터베이스 업데이트 완료! 🎉");

        } catch (err: any) {
          console.error("❌ 최종 에러:", err);
          // 에러 객체가 비어있을 경우를 대비한 처리
          const errMsg = err.message || JSON.stringify(err);
          setStatus(`❌ 업로드 실패: ${errMsg}`);
          toast.error("업로드 실패: 콘솔 로그를 확인하세요.");
        } finally {
          setIsLoading(false);
        }
      },
      error: (err: any) => {
          setStatus(`❌ CSV 파싱 시스템 오류: ${err.message}`);
          setIsLoading(false);
      }
    });
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50 p-10">
      <Toaster />
      <div className="bg-white p-10 rounded-2xl shadow-xl w-full max-w-lg text-center">
        <h1 className="text-2xl font-bold mb-6">🍗 데이터 관리자 (다국어 지원)</h1>
        
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
            <p className="font-bold text-orange-600 mb-2">3. CSV 데이터 업로드 (UTF-8)</p>
            <p className="text-xs text-orange-400 mb-2">* 4개 국어 컬럼이 포함된 CSV 파일을 선택하세요.</p>
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