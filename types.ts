
export enum AgentType {
  IDEIAS = 'ideias',
  ARQUITETURA = 'arquitetura',
  DESENVOLVIMENTO = 'desenvolvimento',
  ANALISES = 'analises',
  MARKETING = 'marketing'
}

export type VoiceType = 'baiana' | 'carioca' | 'pernambucana' | 'mineira';

export interface GroundingSource {
  title: string;
  uri: string;
}

export interface Attachment {
  data: string;
  mimeType: string;
  name: string;
}

export interface Message {
  id: string;
  sender: 'user' | 'agent';
  agentType?: AgentType;
  content: string;
  timestamp: Date;
  type: 'text' | 'audio' | 'image' | 'file' | 'screen';
  fileUrl?: string;
  audioBlob?: Blob;
  isSpeaking?: boolean;
  sources?: GroundingSource[];
  imageUrl?: string;
  attachments?: Attachment[];
}

export interface AgentMetadata {
  id: AgentType;
  name: string;
  fullName: string;
  description: string;
  icon: string;
  color: string;
  systemInstruction: string;
}

export interface ProjectContext {
  name: string;
  description: string;
  stack: string;
  features: string[];
  marketAnalysis: string;
  architecturePlan: string;
  marketingStrategy: string;
}
