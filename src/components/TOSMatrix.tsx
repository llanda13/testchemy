import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Download, Printer } from "lucide-react";
import { PDFExporter } from "@/utils/exportPdf";
import { toast } from "sonner";
import { CanonicalTOSMatrix, BloomLevel } from "@/utils/tosCalculator";
import { supabase } from "@/integrations/supabase/client";

interface TOSMatrixProps {
  data: CanonicalTOSMatrix;
}

const bloomLevels: { key: BloomLevel; label: string; pct: string }[] = [
  { key: 'remembering', label: 'Remembering', pct: '15%' },
  { key: 'understanding', label: 'Understanding', pct: '15%' },
  { key: 'applying', label: 'Applying', pct: '20%' },
  { key: 'analyzing', label: 'Analyzing', pct: '20%' },
  { key: 'evaluating', label: 'Evaluating', pct: '15%' },
  { key: 'creating', label: 'Creating', pct: '15%' },
];

const formatItemNumbers = (items: number[]) => {
  if (items.length === 0) return "";
  if (items.length === 1) return `(${items[0]})`;
  const sorted = [...items].sort((a, b) => a - b);
  const groups: string[] = [];
  let start = sorted[0], end = sorted[0];
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] === end + 1) { end = sorted[i]; }
    else {
      groups.push(start === end ? `${start}` : `${start}-${end}`);
      start = end = sorted[i];
    }
  }
  groups.push(start === end ? `${start}` : `${start}-${end}`);
  return `(${groups.join(',')})`;
};

export const TOSMatrix = ({ data }: TOSMatrixProps) => {
  const { distribution, total_hours, bloom_totals } = data;
  const [institution, setInstitution] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (user) {
        supabase.from('profiles').select('institution').eq('id', user.id).single()
          .then(({ data: profile }) => { if (profile?.institution) setInstitution(profile.institution); });
      }
    }).catch(() => {});
  }, []);

  const actualTotal = Object.values(distribution).reduce((sum, t) => sum + t.total, 0);

  const exportToPDF = async () => {
    try {
      const result = await PDFExporter.exportTOSMatrix(data.id, true);
      PDFExporter.downloadBlob(result.blob, `TOS_${data.subject_no}_${data.exam_period}.pdf`);
      toast.success("TOS matrix exported successfully!");
    } catch (error) {
      toast.error("Failed to export PDF");
      console.error("Export error:", error);
    }
  };

  const handlePrint = () => window.print();

  const cellBase = "border border-black px-2 py-1 text-center align-middle";
  const headerBg = "bg-[#e8f5e9]";

  return (
    <div className="space-y-4">
      {/* Action Buttons */}
      <div className="flex gap-2 print:hidden">
        <Button onClick={exportToPDF} variant="default">
          <Download className="h-4 w-4 mr-2" />Export PDF
        </Button>
        <Button onClick={handlePrint} variant="outline">
          <Printer className="h-4 w-4 mr-2" />Print
        </Button>
      </div>

      {/* Printable TOS Document */}
      <div id="tos-matrix-export" className="tos-print-document bg-white text-black p-6 print:p-0">
        {/* Title */}
        <div className="text-center mb-4 border-b-2 border-black pb-3">
          {institution && <div className="text-base font-bold uppercase">{institution}</div>}
          <h1 className="text-lg font-bold uppercase tracking-wide">TWO-WAY TABLE OF SPECIFICATION</h1>
        </div>

        {/* Course Info – two-column with underline style matching reference */}
        <div className="grid grid-cols-2 gap-x-12 gap-y-0.5 mb-4 text-sm">
          <div>College: <span className="underline">{data.course ? `College of ${data.course}` : '_______________'}</span></div>
          <div>Examination Period: <span className="underline">{data.exam_period || '_______________'}</span></div>
          <div>Subject No.: <span className="underline">{data.subject_no || '_______________'}</span></div>
          <div>Year and Section: <span className="underline">{data.year_section || '_______________'}</span></div>
          <div>Description: <span className="underline">{data.description || '_______________'}</span></div>
          <div>Course: <span className="underline">{data.course || '_______________'}</span></div>
        </div>

        {/* Official TOS Table */}
        <table className="w-full border-collapse border-2 border-black text-[11px]">
          <thead>
            {/* Row 1 */}
            <tr>
              <th rowSpan={3} className={`${cellBase} ${headerBg} font-bold min-w-[140px]`}>TOPIC</th>
              <th rowSpan={3} className={`${cellBase} ${headerBg} font-bold w-[70px]`}>NO. OF<br/>HOURS</th>
              <th rowSpan={3} className={`${cellBase} ${headerBg} font-bold w-[65px]`}>PERCEN<br/>TAGE</th>
              <th colSpan={6} className={`${cellBase} ${headerBg} font-bold`}>COGNITIVE DOMAINS</th>
              <th rowSpan={3} className={`${cellBase} ${headerBg} font-bold w-[60px]`}>ITEM<br/>PLACEMENT</th>
              <th rowSpan={3} className={`${cellBase} ${headerBg} font-bold w-[50px]`}>TOTAL</th>
            </tr>
            {/* Row 2 – difficulty groups */}
            <tr>
              <th colSpan={2} className={`${cellBase} ${headerBg} font-bold text-[10px]`}>EASY (30%)</th>
              <th colSpan={2} className={`${cellBase} ${headerBg} font-bold text-[10px]`}>AVERAGE (40%)</th>
              <th colSpan={2} className={`${cellBase} ${headerBg} font-bold text-[10px]`}>DIFFICULT (30%)</th>
            </tr>
            {/* Row 3 – individual bloom levels */}
            <tr>
              {bloomLevels.map((l) => (
                <th key={l.key} className={`${cellBase} ${headerBg} font-bold text-[10px] w-[72px]`}>
                  {l.label}<br/>({l.pct})
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.topics.map((topic) => {
              const name = topic.topic;
              const d = distribution[name];
              const pct = d?.percentage || 0;
              const total = d?.total || 0;
              // Collect all item numbers for placement column
              const allItems = bloomLevels
                .flatMap(l => d?.[l.key]?.items || [])
                .sort((a, b) => a - b);

              return (
                <tr key={name}>
                  <td className={`${cellBase} text-left font-medium`}>{name}</td>
                  <td className={cellBase}>{topic.hours} hours</td>
                  <td className={cellBase}>{pct}%</td>
                  {bloomLevels.map((l) => {
                    const bloom = d?.[l.key];
                    const count = bloom?.count || 0;
                    const items = bloom?.items || [];
                    return (
                      <td key={l.key} className={cellBase}>
                        {count > 0 ? (
                          <>
                            <div className="font-semibold">{count}</div>
                            <div className="text-[9px]">{formatItemNumbers(items)}</div>
                          </>
                        ) : ""}
                      </td>
                    );
                  })}
                  <td className={`${cellBase} font-semibold`}>
                    {allItems.length > 0 ? "I" : "-"}
                  </td>
                  <td className={`${cellBase} font-bold`}>{total}</td>
                </tr>
              );
            })}

            {/* TOTAL row */}
            <tr className="font-bold">
              <td className={`${cellBase} font-bold`}>TOTAL</td>
              <td className={cellBase}>{total_hours}</td>
              <td className={cellBase}>100%</td>
              {bloomLevels.map((l) => (
                <td key={l.key} className={`${cellBase} font-bold`}>{bloom_totals[l.key]}</td>
              ))}
              <td className={cellBase}></td>
              <td className={`${cellBase} font-bold text-sm`}>{actualTotal}</td>
            </tr>
          </tbody>
        </table>

        {/* Signatures */}
        <div className="mt-10 grid grid-cols-2 gap-8 text-sm">
          <div>
            <p className="mb-14">Prepared by:</p>
            <div className="border-b border-black w-60 mx-auto mb-1" />
            <p className="text-center font-bold">{data.prepared_by || ""}</p>
          </div>
          <div>
            <p className="mb-14">Noted by:</p>
            <div className="border-b border-black w-60 mx-auto mb-1" />
            <p className="text-center font-bold">{data.noted_by || ""}</p>
          </div>
        </div>
      </div>
    </div>
  );
};
