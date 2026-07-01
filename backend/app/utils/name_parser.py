import re
from typing import Tuple, Optional

class NameParser:
    @staticmethod
    def parse_episode(filename: str) -> Optional[Tuple[int, int]]:
        """
        从文件名解析出季号和集号
        返回 (season, episode)
        如果解析失败返回 None
        """
        # 清除常见的无关信息，防止干扰解析
        clean_name = re.sub(r'\[.*?\]', '', filename) # 移除 [xxx] 中的内容
        clean_name = re.sub(r'\{.*?\}', '', clean_name) # 移除 {xxx} 中的内容
        clean_name = re.sub(r'\(.*?\)', '', clean_name) # 移除 (xxx) 中的内容
        
        # 匹配 S01E01 或 s1e01 或 S1E1 或 s01 e01 (忽略大小写)
        match = re.search(r'S(\d+)\s*E(\d+)', clean_name, re.IGNORECASE)
        if match:
            return (int(match.group(1)), int(match.group(2)))
            
        # 匹配 第1季 第2集 或 第一季 第二集
        match = re.search(r'第(\d+)季.*?第(\d+)集', clean_name)
        if match:
            return (int(match.group(1)), int(match.group(2)))
            
        # 只匹配 第x集
        match = re.search(r'第(\d+)集', clean_name)
        if match:
            return (1, int(match.group(1)))
            
        # 匹配 EP01 或 E01
        match = re.search(r'EP?(\d+)', clean_name, re.IGNORECASE)
        if match:
            return (1, int(match.group(1)))
            
        # 匹配 - 01 或 01 (常用于动漫，如 繁花 01.mp4)
        # 前面必须有空格或者 - 等分隔符，后面跟着数字，再跟着视频后缀
        match = re.search(r'(?:[-_ ]|^\s*)(\d{1,4})\s*(?:\.mp4|\.mkv|\.avi|\.ts|\.rmvb|\.flv|\.m4v|\.webm)', clean_name, re.IGNORECASE)
        if match:
            return (1, int(match.group(1)))
            
        return None

name_parser = NameParser()
